package claude

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/alwaysking/akmdlibrary/internal/repository"
)

// SessionCallbacks 是 session 向 handler 回调的接口。
type SessionCallbacks struct {
	OnStatus           func(status string) // "answering" | "idle"
	OnAssistantText    func(text string)
	OnPermissionDenied func(tool, path, reason string)
	OnToolFileChanged  func(tool, filePath string) // Write/Edit/MultiEdit 成功执行后触发
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
	sessionID    string
	spaceSlug    string
	spaceDir     string
	attachDir    string
	userWrite    bool
	toolCfg      ToolConfig
	sysPrompt    string
	envOverrides map[string]string
	pageRepo     *repository.PageRepository
	callbacks    SessionCallbacks

	// pendingToolUses 缓存 tool_use（由 assistant 消息产出），
	// 等对应 tool_use_id 的 tool_result（user 消息）到达时再决定是否触发 OnToolFileChanged。
	// readLoop 串行调用 handleLine，无需加锁。
	pendingToolUses map[string]pendingToolUse
}

// pendingToolUse 是 pendingToolUses 表的条目。
type pendingToolUse struct {
	toolName string
	input    map[string]any
}

type SessionParams struct {
	SessionID    string                         // 由 manager 生成
	SpaceSlug    string                         // 用于构造与 Page.file_path 一致的路径
	SpaceDir     string                         // 子进程 cwd
	AttachDir    string                         // /tmp/.../session/<id>，由 manager 创建好
	EnvOverrides map[string]string              // settings.json.env 的覆盖
	SystemPrompt string
	UserCanWrite bool
	ToolConfig   ToolConfig
	PageRepo     *repository.PageRepository
	Callbacks    SessionCallbacks
}

// NewSession 创建（不启动）一个 session。
func NewSession(p SessionParams) *Session {
	return &Session{
		sessionID:       p.SessionID,
		spaceSlug:       p.SpaceSlug,
		spaceDir:        p.SpaceDir,
		attachDir:       p.AttachDir,
		userWrite:       p.UserCanWrite,
		toolCfg:         p.ToolConfig,
		sysPrompt:       p.SystemPrompt,
		envOverrides:    p.EnvOverrides,
		pageRepo:        p.PageRepo,
		callbacks:       p.Callbacks,
		pendingToolUses: make(map[string]pendingToolUse),
	}
}

// Start 启动 claude 子进程并消费 stdout。claude 二进制名固定为 "claude"，依赖 PATH 解析。
func (s *Session) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	claudePath := "claude"

	args := []string{
		"--print",
		"--verbose",
		"--output-format", "stream-json",
		"--input-format", "stream-json",
		"--permission-prompt-tool", "stdio",
	}
	// 把 sessionID 同时作为 claude 的 session_id（日志关联方便；不影响持久化策略）
	if s.sessionID != "" {
		args = append(args, "--session-id", s.sessionID)
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
			// 把退出原因一并记到日志（前端只收到精简版）
			log.Printf("[claude session] process exit: %v", err)
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
		// 非 JSON 输出（claude 在 stream-json 模式下不应有，出现说明异常）
		log.Printf("[claude session] non-JSON stdout line: %s", string(line))
		return
	}
	switch probe.Type {
	case "assistant":
		s.handleAssistant(line)
	case "user":
		s.handleUser(line)
	case "control_request":
		s.handleControlRequest(line)
	case "result":
		// 一轮回答结束
		s.callbacks.OnStatus("idle")
	case "system", "stream_event":
		// 已知但当前不处理的类型，落到 debug 日志方便排查
		log.Printf("[claude session] %s: %s", probe.Type, string(line))
	default:
		// 未知类型（可能是 error 等），完整记录
		log.Printf("[claude session] unknown type=%s: %s", probe.Type, string(line))
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
	// 缓存本轮 tool_use，等 tool_result 到达后再决定是否通知文件变更
	for _, tu := range msg.ExtractToolUses() {
		if tu.ID == "" {
			continue
		}
		s.pendingToolUses[tu.ID] = pendingToolUse{
			toolName: tu.Name,
			input:    tu.Input,
		}
		log.Printf("[claude session][debug] cached tool_use: id=%s name=%s input_keys=%v", tu.ID, tu.Name, keysOf(tu.Input))
	}
}

// handleUser 处理 claude 回传的 user 消息（一般是 tool_result）。
// 这里只关心文件修改类工具的执行结果；其他 tool_result（Read/Bash/Grep 等）忽略。
func (s *Session) handleUser(line []byte) {
	var msg ToolResultMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		log.Printf("[claude session][debug] handleUser unmarshal failed: %v", err)
		return
	}
	results := msg.ExtractToolResults()
	log.Printf("[claude session][debug] user message: %d tool_result(s), pending_size=%d", len(results), len(s.pendingToolUses))
	for _, tr := range results {
		pending, ok := s.pendingToolUses[tr.ToolUseID]
		if !ok {
			log.Printf("[claude session][debug] tool_result id=%s NOT in pending (miss)", tr.ToolUseID)
			continue
		}
		delete(s.pendingToolUses, tr.ToolUseID)
		log.Printf("[claude session][debug] tool_result id=%s matched pending name=%s is_error=%v", tr.ToolUseID, pending.toolName, tr.IsError)
		if tr.IsError {
			continue
		}
		// 只关心文件修改类工具
		switch pending.toolName {
		case "Write", "Edit", "MultiEdit":
			rawPath, _ := pending.input["file_path"].(string)
			if rawPath == "" {
				log.Printf("[claude session][debug] %s: empty file_path, skip", pending.toolName)
				continue
			}
			if s.callbacks.OnToolFileChanged == nil {
				log.Printf("[claude session][debug] %s: OnToolFileChanged callback nil, skip", pending.toolName)
				continue
			}
			// 解析为绝对路径。空间外的路径（理论被权限层挡掉）做兜底校验。
			absPath := rawPath
			if !filepath.IsAbs(absPath) {
				absPath = filepath.Join(s.spaceDir, absPath)
			}
			relPath, err := filepath.Rel(s.spaceDir, absPath)
			if err != nil || strings.HasPrefix(relPath, "..") {
				log.Printf("[claude session][debug] %s: path outside spaceDir abs=%s spaceDir=%s", pending.toolName, absPath, s.spaceDir)
				continue
			}
			// 构造与 Page.file_path 一致的格式：spaceSlug + "/" + space内相对路径
			// 前端可直接用 === 与 currentPage.file_path 比对，无需后端查 DB。
			pageFilePath := strings.TrimPrefix(filepath.Join(s.spaceSlug, relPath), "/")
			log.Printf("[claude session][debug] firing OnToolFileChanged: tool=%s pageFilePath=%s", pending.toolName, pageFilePath)
			s.callbacks.OnToolFileChanged(pending.toolName, pageFilePath)
		default:
			log.Printf("[claude session][debug] %s: not file-modifying tool, skip", pending.toolName)
		}
	}
}

// keysOf 返回 map 的键集合（仅用于诊断日志，顺序无意义）。
func keysOf(m map[string]any) []string {
	if len(m) == 0 {
		return nil
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
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
		AttachDir:    s.attachDir,
		ToolConfig:   s.toolCfg,
	})
	// 回应 claude；allow 时把原始 input 原样回传为 updatedInput（Claude Code 2.1.201+ 要求）
	resp := NewControlResponse(cr.RequestID, result.Allowed, result.Reason, cr.Request.Input)
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

// SendInterrupt 中止当前回答：向 claude 发 control_request subtype=interrupt。
// claude 会停止当前生成并产出一条带 "[Request interrupted by user]" 的收尾消息。
func (s *Session) SendInterrupt() {
	msg := map[string]any{
		"type": "control_request",
		"request": map[string]any{
			"subtype": "interrupt",
		},
		"request_id": fmt.Sprintf("interrupt_%d", time.Now().UnixMilli()),
	}
	s.writeJSON(msg)
	log.Printf("[claude session] sent interrupt")
}
//
// 拼装顺序：
//   1. 当前文档（如果 context.ActivePageID 不为空）：text block
//   2. 选中文本（如果 context.Selection 不为空）：text block
//   3. 每个附件：图片走 image block（直接看），其他文件走 text block（告诉路径）
//   4. 用户提示词原文（含 @filename 标记，原样透传）
func (s *Session) SendUserMessage(text string, ctx *ClientContext, attachments []string) {
	s.callbacks.OnStatus("answering")

	blocks := s.buildContextBlocks(text, ctx, attachments)
	s.writeJSON(NewUserMessageFromBlocks(blocks))
}

// buildContextBlocks 把 UI 状态翻译成 claude 的 content blocks。
func (s *Session) buildContextBlocks(text string, ctx *ClientContext, attachments []string) []ContentBlock {
	var blocks []ContentBlock

	// 当前文档：page id → file_path → 绝对路径
	if ctx != nil && ctx.ActivePageID != "" && s.pageRepo != nil {
		if page, err := s.pageRepo.GetByID(ctx.ActivePageID); err == nil && page != nil {
			absPath := filepath.Join(s.spaceDir, page.FilePath)
			blocks = append(blocks, ContentBlock{
				Type: "text",
				Text: fmt.Sprintf("当前文件: %s", absPath),
			})
		}
	}

	// 选中文本
	if ctx != nil && strings.TrimSpace(ctx.Selection) != "" {
		blocks = append(blocks, ContentBlock{
			Type: "text",
			Text: fmt.Sprintf("当前选中的内容:\n\n%s", ctx.Selection),
		})
	}

	// 附件：每个附件都建立 @filename 到内容的明确映射
	for _, attID := range attachments {
		attPath, attFilename, ok := s.resolveAttachment(attID)
		if !ok {
			blocks = append(blocks, ContentBlock{
				Type: "text",
				Text: fmt.Sprintf("(用户引用了附件 %s，但文件不存在)", attID),
			})
			continue
		}

		if mediaType, ok := imageMediaType(attFilename); ok {
			// 图片：image block + 紧跟的 text block 标注 @filename 映射
			if imgBlock, err := buildImageBlock(attPath, mediaType); err == nil {
				blocks = append(blocks, imgBlock)
				blocks = append(blocks, ContentBlock{
					Type: "text",
					Text: fmt.Sprintf("（上方图片对应用户引用的 @%s）", attFilename),
				})
				continue
			}
		}

		// 其他文件：text block 告诉路径 + @filename 映射
		blocks = append(blocks, ContentBlock{
			Type: "text",
			Text: fmt.Sprintf("用户上传了文件 @%s，路径: %s", attFilename, attPath),
		})
	}

	// 用户提示词（原样透传，@filename 让 claude 根据前面的块自己推理）
	blocks = append(blocks, ContentBlock{Type: "text", Text: text})

	if len(blocks) == 0 {
		blocks = []ContentBlock{{Type: "text", Text: text}}
	}
	return blocks
}

// resolveAttachment 在 attachDir 里查找附件路径。
// 命名约定：<attachmentID>_<originalFilename>
func (s *Session) resolveAttachment(attachmentID string) (path, filename string, ok bool) {
	if s.attachDir == "" || attachmentID == "" {
		return "", "", false
	}
	entries, err := os.ReadDir(s.attachDir)
	if err != nil {
		return "", "", false
	}
	prefix := attachmentID + "_"
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.HasPrefix(e.Name(), prefix) {
			full := filepath.Join(s.attachDir, e.Name())
			original := strings.TrimPrefix(e.Name(), prefix)
			return full, original, true
		}
	}
	return "", "", false
}

// imageMediaType 用扩展名判断是否是 claude 支持的图片格式。
func imageMediaType(filename string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".png":
		return "image/png", true
	case ".jpg", ".jpeg":
		return "image/jpeg", true
	case ".gif":
		return "image/gif", true
	case ".webp":
		return "image/webp", true
	default:
		return "", false
	}
}

// buildImageBlock 读图片文件 base64 编码成 image block。
func buildImageBlock(path, mediaType string) (ContentBlock, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ContentBlock{}, err
	}
	return ContentBlock{
		Type: "image",
		Source: &ImageSource{
			Type:      "base64",
			MediaType: mediaType,
			Data:      base64.StdEncoding.EncodeToString(data),
		},
	}, nil
}

// Stop 终止子进程并清理附件目录。
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
	if s.attachDir != "" {
		if err := os.RemoveAll(s.attachDir); err != nil {
			log.Printf("[claude session] cleanup attachDir %s failed: %v", s.attachDir, err)
		}
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
		switch msg.Type {
		case "user_message":
			s.SendUserMessage(msg.Content, msg.Context, msg.Attachments)
		case "stop":
			// 用户点击中止按钮：向 claude 发 interrupt
			s.SendInterrupt()
		}
	}
}

// SessionID 暴露给 manager 用于 HTTP 上传接口。
func (s *Session) SessionID() string { return s.sessionID }

// AttachDir 暴露给 manager 用于上传接口写入文件。
func (s *Session) AttachDir() string { return s.attachDir }

// 生成新的 sessionID（暴露给 manager）
func NewSessionID() string { return uuid.NewString() }
