package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"

	"github.com/coder/websocket"
)

// SessionCallbacks 是 session 向 handler 回调的接口。
type SessionCallbacks struct {
	OnStatus           func(status string) // "answering" | "idle"
	OnAssistantText    func(text string)
	OnPermissionDenied func(tool, path, reason string)
	OnError            func(message string)
}

// Session 封装一个 claude 子进程 + 一个 WS 连接。
type Session struct {
	cmd          *exec.Cmd
	stdin        io.WriteCloser
	stdout       io.ReadCloser
	stdoutMu     sync.Mutex // 保护 stdin 写入
	wg           sync.WaitGroup
	cancel       context.CancelFunc
	spaceDir     string
	userWrite    bool
	toolCfg      ToolConfig
	sysPrompt    string
	envOverrides map[string]string
	callbacks    SessionCallbacks
}

type SessionParams struct {
	SpaceDir     string            // 子进程 cwd
	EnvOverrides map[string]string // settings.json.env 的覆盖
	SystemPrompt string
	UserCanWrite bool
	ToolConfig   ToolConfig
	Callbacks    SessionCallbacks
}

// NewSession 创建（不启动）一个 session。
func NewSession(p SessionParams) *Session {
	return &Session{
		spaceDir:     p.SpaceDir,
		userWrite:    p.UserCanWrite,
		toolCfg:      p.ToolConfig,
		sysPrompt:    p.SystemPrompt,
		envOverrides: p.EnvOverrides,
		callbacks:    p.Callbacks,
	}
}

// Start 启动 claude 子进程并消费 stdout。claude 二进制名固定为 "claude"，依赖 PATH 解析。
func (s *Session) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	claudePath := "claude"

	args := []string{
		"--print",
		"--output-format", "stream-json",
		"--input-format", "stream-json",
		"--permission-prompt-tool", "stdio",
	}
	if s.sysPrompt != "" {
		args = append(args, "--append-system-prompt", s.sysPrompt)
	}

	cmd := exec.CommandContext(ctx, claudePath, args...)
	cmd.Dir = s.spaceDir

	// 环境：继承父进程 + envOverrides
	env := append([]string{}, cmd.Environ()...)
	for k, v := range s.envOverrides {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = logWriter{}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start claude: %w", err)
	}
	s.cmd = cmd
	s.stdin = stdin
	s.stdout = stdout

	s.wg.Add(1)
	go s.readLoop()

	go func() {
		err := cmd.Wait()
		if err != nil && ctx.Err() == nil {
			s.callbacks.OnError(fmt.Sprintf("claude 进程退出: %v", err))
		}
		s.wg.Wait()
	}()
	return nil
}

// logWriter 把 claude stderr 转发到 log。
type logWriter struct{}

func (logWriter) Write(p []byte) (int, error) {
	log.Printf("[claude stderr] %s", string(p))
	return len(p), nil
}

// readLoop 解析 stdout 的每行 JSON。
func (s *Session) readLoop() {
	defer s.wg.Done()
	scanner := bufio.NewScanner(s.stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024) // 单行最大 8MB
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		s.handleLine(line)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("[claude session] scanner error: %v", err)
	}
}

func (s *Session) handleLine(line []byte) {
	// 先探一下 type 字段
	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &probe); err != nil {
		return
	}
	switch probe.Type {
	case "assistant":
		s.handleAssistant(line)
	case "control_request":
		s.handleControlRequest(line)
	case "result":
		// 一轮回答结束
		s.callbacks.OnStatus("idle")
	default:
		// system/init/user/stream_event 等忽略
	}
}

func (s *Session) handleAssistant(line []byte) {
	s.callbacks.OnStatus("answering")
	var msg AssistantMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		return
	}
	text := msg.ExtractText()
	if text != "" {
		s.callbacks.OnAssistantText(text)
	}
}

func (s *Session) handleControlRequest(line []byte) {
	var cr ControlRequest
	if err := json.Unmarshal(line, &cr); err != nil {
		return
	}
	result := Check(PermissionInput{
		ToolName:     cr.Request.ToolName,
		ToolInput:    cr.Request.Input,
		UserCanWrite: s.userWrite,
		SpaceDir:     s.spaceDir,
		ToolConfig:   s.toolCfg,
	})
	// 回应 claude
	resp := NewControlResponse(cr.RequestID, result.Allowed, result.Reason)
	s.writeJSON(resp)
	// 拒绝时通知前端
	if !result.Allowed {
		s.callbacks.OnPermissionDenied(cr.Request.ToolName, result.Path, result.Reason)
	}
}

// writeJSON 把消息写到 claude stdin（线程安全）。
func (s *Session) writeJSON(v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	raw = append(raw, '\n')
	s.stdoutMu.Lock()
	defer s.stdoutMu.Unlock()
	if s.stdin != nil {
		_, _ = s.stdin.Write(raw)
	}
}

// SendUserMessage 接收用户文本，转成 stdin 格式发出。
func (s *Session) SendUserMessage(text string) {
	s.callbacks.OnStatus("answering")
	s.writeJSON(NewUserMessage(text))
}

// Stop 终止子进程。
func (s *Session) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
}

// HandleWebSocket 把前端 WS 消息桥接到 session。
// 阻塞直到 WS 关闭或 ctx 取消。
func (s *Session) HandleWebSocket(ctx context.Context, c *websocket.Conn) {
	go func() {
		<-ctx.Done()
		_ = c.Close(websocket.StatusNormalClosure, "session end")
	}()

	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "user_message" {
			s.SendUserMessage(msg.Content)
		}
	}
}
