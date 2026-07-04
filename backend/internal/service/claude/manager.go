package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/coder/websocket"

	"github.com/alwaysking/akmdlibrary/internal/repository"
)

// tokenVerifier 是 AuthService 满足的最小接口。
type tokenVerifier interface {
	VerifyToken(tokenString string) (int, error)
}

// Manager 持有所有运行中 session 的引用 + 启动 session 所需依赖。
type Manager struct {
	mu         sync.Mutex
	sessions   map[*websocket.Conn]*Session
	config     *ConfigStore
	memberRepo *repository.MemberRepository
	spaceRepo  *repository.SpaceRepository
	auth       tokenVerifier
	docsDir    string
}

// NewManager 构造 manager。auth 通常传 *service.AuthService。
func NewManager(
	config *ConfigStore,
	memberRepo *repository.MemberRepository,
	spaceRepo *repository.SpaceRepository,
	auth tokenVerifier,
	docsDir string,
) *Manager {
	return &Manager{
		sessions:   map[*websocket.Conn]*Session{},
		config:     config,
		memberRepo: memberRepo,
		spaceRepo:  spaceRepo,
		auth:       auth,
		docsDir:    docsDir,
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
	canWrite := member.Role == "editor" || member.Role == "admin"
	return spaceDir, canWrite, nil
}

// StartSession 创建并启动一个 session，注册到 manager。
func (m *Manager) StartSession(ctx context.Context, params StartSessionParams) (*Session, error) {
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
		SpaceDir:     params.SpaceDir,
		EnvOverrides: m.config.LoadSettingsEnv(),
		SystemPrompt: m.config.LoadSystemPrompt(),
		UserCanWrite: params.UserCanWrite,
		ToolConfig:   m.config.LoadToolConfig(),
		Callbacks:    cb,
	})
	if err := sess.Start(ctx); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.sessions[params.Conn] = sess
	m.mu.Unlock()
	return sess, nil
}

// StopSession 在 WS 关闭时调用：杀子进程、移除映射。
func (m *Manager) StopSession(conn *websocket.Conn) {
	m.mu.Lock()
	sess := m.sessions[conn]
	delete(m.sessions, conn)
	m.mu.Unlock()
	if sess != nil {
		sess.Stop()
	}
}

type StartSessionParams struct {
	Conn         *websocket.Conn
	SpaceDir     string
	UserCanWrite bool
}
