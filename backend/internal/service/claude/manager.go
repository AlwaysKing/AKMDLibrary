package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/coder/websocket"

	"github.com/alwaysking/akmdlibrary/internal/repository"
)

// tokenVerifier 是 AuthService 满足的最小接口。
type tokenVerifier interface {
	VerifyToken(tokenString string) (int, error)
}

// pageRepoResolver 是 PageService 满足的最小接口（按 slug 取 pageRepo）。
type pageRepoResolver interface {
	GetRepo(spaceSlug string) (*repository.PageRepository, error)
}

// Manager 持有所有运行中 session 的引用 + 启动 session 所需依赖。
type Manager struct {
	mu          sync.Mutex
	sessions    map[*websocket.Conn]*Session
	config      *ConfigStore
	memberRepo  *repository.MemberRepository
	spaceRepo   *repository.SpaceRepository
	pageService pageRepoResolver
	auth        tokenVerifier
	docsDir     string
	tmpRoot     string // 附件根目录：os.TempDir()/akmdlibrary/session
}

// NewManager 构造 manager。auth 通常传 *service.AuthService，pageService 通常传 *service.PageService。
func NewManager(
	config *ConfigStore,
	memberRepo *repository.MemberRepository,
	spaceRepo *repository.SpaceRepository,
	pageService pageRepoResolver,
	auth tokenVerifier,
	docsDir string,
) *Manager {
	return &Manager{
		sessions:    map[*websocket.Conn]*Session{},
		config:      config,
		memberRepo:  memberRepo,
		spaceRepo:   spaceRepo,
		pageService: pageService,
		auth:        auth,
		docsDir:     docsDir,
		// 固定路径而非 os.TempDir()：macOS 上 TempDir 是 /var/folders/... 不直观，
		// 用 /tmp/akmdlibrary/session 调试方便，跨平台兼容（Linux/Docker 都有 /tmp）。
		tmpRoot: filepath.Join("/tmp", "akmdlibrary", "session"),
	}
}

// VerifyToken 暴露给 handler 校验 JWT。
func (m *Manager) VerifyToken(token string) (int, error) {
	return m.auth.VerifyToken(token)
}

// ResolveSpaceAndPermission 解析 slug 到 space 目录 + 用户写权限。
// 不满足访问返回 error（handler 转 403）。
func (m *Manager) ResolveSpaceAndPermission(slug string, userID int) (string, bool, error) {
	space, err := m.spaceRepo.GetBySlug(slug)
	if err != nil || space == nil {
		return "", false, fmt.Errorf("space not found")
	}
	if !space.ParseFeatureFlags().Claude {
		return "", false, fmt.Errorf("claude feature disabled for this space")
	}
	member, err := m.memberRepo.GetBySpaceAndUser(space.ID, userID)
	if err != nil || member == nil {
		return "", false, fmt.Errorf("not a member of this space")
	}
	spaceDir := filepath.Join(m.docsDir, space.Name) // 与现有 space_service 一致：目录用 Name
	// 解析成绝对路径，避免子进程 cwd 是相对路径造成歧义。
	if abs, err := filepath.Abs(spaceDir); err == nil {
		spaceDir = abs
	}
	// 解析 symlink：userdata/docs/<name> 可能是软链接指向真实目录。
	// 子进程启动后 os.Getwd() 会返回真实路径，如果我们传给 claude 的"当前文件"路径
	// 是未解析的 symlink 路径，会导致 claude 困惑、Glob 上层目录触发 permission 拒绝。
	if real, err := filepath.EvalSymlinks(spaceDir); err == nil {
		spaceDir = real
	}
	canWrite := member.Role == "editor" || member.Role == "admin"
	return spaceDir, canWrite, nil
}

// StartSession 创建并启动一个 session，注册到 manager。
// 启动后通过 OnSessionInit 回调把 sessionID 推给前端，前端用此 id 调上传接口。
func (m *Manager) StartSession(ctx context.Context, params StartSessionParams) (*Session, error) {
	sessionID := NewSessionID()
	attachDir := filepath.Join(m.tmpRoot, sessionID)
	if err := os.MkdirAll(attachDir, 0o700); err != nil {
		return nil, fmt.Errorf("create attach dir: %w", err)
	}

	// 按 space slug 解析对应 pageRepo（每个 space 一个 db）
	var pageRepo *repository.PageRepository
	if m.pageService != nil && params.SpaceSlug != "" {
		if repo, err := m.pageService.GetRepo(params.SpaceSlug); err == nil {
			pageRepo = repo
		} else {
			log.Printf("[claude manager] get page repo for slug=%s failed: %v", params.SpaceSlug, err)
		}
	}

	cb := SessionCallbacks{
		OnStatus: func(status string) {
			data, _ := json.Marshal(EventStatus{Type: "status", Status: status})
			_ = params.Conn.Write(ctx, websocket.MessageText, data)
		},
		OnAssistantText: func(text string) {
			data, _ := json.Marshal(EventAssistantMessage{Type: "assistant_message", Content: text})
			_ = params.Conn.Write(ctx, websocket.MessageText, data)
		},
		OnPermissionDenied: func(tool, path, reason string) {
			data, _ := json.Marshal(EventPermissionDenied{Type: "permission_denied", Tool: tool, Path: path, Reason: reason})
			_ = params.Conn.Write(ctx, websocket.MessageText, data)
		},
		OnError: func(message string) {
			data, _ := json.Marshal(EventError{Type: "error", Message: message})
			_ = params.Conn.Write(ctx, websocket.MessageText, data)
		},
	}
	sess := NewSession(SessionParams{
		SessionID:    sessionID,
		SpaceDir:     params.SpaceDir,
		AttachDir:    attachDir,
		EnvOverrides: m.config.LoadSettingsEnv(),
		SystemPrompt: m.config.LoadSystemPrompt(),
		UserCanWrite: params.UserCanWrite,
		ToolConfig:   m.config.LoadToolConfig(),
		PageRepo:     pageRepo,
		Callbacks:    cb,
	})
	if err := sess.Start(ctx); err != nil {
		// 启动失败也要清理已创建的 attachDir
		_ = os.RemoveAll(attachDir)
		return nil, err
	}

	// 推 session_init，前端拿到后才能上传附件
	initData, _ := json.Marshal(EventSessionInit{Type: "session_init", SessionID: sessionID})
	if err := params.Conn.Write(ctx, websocket.MessageText, initData); err != nil {
		log.Printf("[claude manager] push session_init failed: %v", err)
	}

	m.mu.Lock()
	m.sessions[params.Conn] = sess
	m.mu.Unlock()
	return sess, nil
}

// StopSession 在 WS 关闭时调用：杀子进程、移除映射、清理附件目录。
func (m *Manager) StopSession(conn *websocket.Conn) {
	m.mu.Lock()
	sess := m.sessions[conn]
	delete(m.sessions, conn)
	m.mu.Unlock()
	if sess != nil {
		sess.Stop()
	}
}

// SessionByConn 暴露给 HTTP 上传 handler 用：根据 WS 连接查 session。
// 注意：上传 handler 拿不到 WS 连接，用 SessionByID 替代。
func (m *Manager) SessionByConn(conn *websocket.Conn) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[conn]
}

// SessionByID 通过 sessionID 查 session（HTTP 上传接口使用）。
func (m *Manager) SessionByID(sessionID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.SessionID() == sessionID {
			return s
		}
	}
	return nil
}

// SaveAttachment 把上传的文件落到对应 session 的 attachDir。
// 返回 attachmentID 和最终文件名（含 ID 前缀）。
//
// 文件名去重策略：同名文件依次加 " (1)"、" (2)"... 后缀。
func (m *Manager) SaveAttachment(sessionID, originalFilename string, data []byte) (attachmentID, storedFilename string, err error) {
	sess := m.SessionByID(sessionID)
	if sess == nil {
		return "", "", fmt.Errorf("session not found: %s", sessionID)
	}
	attachDir := sess.AttachDir()
	if attachDir == "" {
		return "", "", fmt.Errorf("session has no attachDir")
	}

	attachmentID = NewSessionID() // 复用 uuid 生成器；attachmentID 也用 uuid
	uniqueName := dedupeFilename(attachDir, originalFilename)
	storedFilename = attachmentID + "_" + uniqueName
	fullPath := filepath.Join(attachDir, storedFilename)

	if err := os.WriteFile(fullPath, data, 0o600); err != nil {
		return "", "", fmt.Errorf("write attachment: %w", err)
	}
	return attachmentID, uniqueName, nil
}

// dedupeFilename 在 attachDir 内若已存在 originalFilename，自动加 " (N)" 后缀。
func dedupeFilename(attachDir, filename string) string {
	target := filename
	if _, err := os.Stat(filepath.Join(attachDir, target)); os.IsNotExist(err) {
		return target
	}
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Stat(filepath.Join(attachDir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

type StartSessionParams struct {
	Conn         *websocket.Conn
	SpaceSlug    string
	SpaceDir     string
	UserCanWrite bool
}
