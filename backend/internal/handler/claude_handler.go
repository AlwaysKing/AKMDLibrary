package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/alwaysking/akmdlibrary/internal/service/claude"
)

// ClaudeHandler 处理管理员 Claude 配置接口与 WebSocket 聊天。
type ClaudeHandler struct {
	config  *claude.ConfigStore
	manager *claude.Manager
}

func NewClaudeHandler(config *claude.ConfigStore, manager *claude.Manager) *ClaudeHandler {
	return &ClaudeHandler{config: config, manager: manager}
}

// GetConfig GET /api/admin/claude/config
func (h *ClaudeHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.config.Load()
	if err != nil {
		http.Error(w, "failed to load claude config", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

// UpdateConfig PUT /api/admin/claude/config
func (h *ClaudeHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req claude.AdminConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	// settings.json 必须是合法 JSON 对象（已经 map[string]any，自然合法）
	if req.SettingsJSON == nil {
		req.SettingsJSON = map[string]any{}
	}
	if err := h.config.Save(&req); err != nil {
		http.Error(w, "failed to save claude config", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// ChatWS GET /api/spaces/{slug}/claude/ws
// 注意：本路由不挂 RequireAuth middleware（浏览器 WS 无法设置 Authorization header）。
// 鉴权由 handler 内部从 query param ?token= 校验 + space member 校验。
func (h *ClaudeHandler) ChatWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token required", http.StatusUnauthorized)
		return
	}
	userID, err := h.manager.VerifyToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	slug := chi.URLParam(r, "slug")
	if slug == "" {
		http.Error(w, "slug required", http.StatusBadRequest)
		return
	}

	spaceDir, canWrite, err := h.manager.ResolveSpaceAndPermission(slug, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("[claude ws] upgrade failed: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sess, err := h.manager.StartSession(ctx, claude.StartSessionParams{
		Conn:         c,
		SpaceDir:     spaceDir,
		UserCanWrite: canWrite,
	})
	if err != nil {
		data, _ := json.Marshal(claude.EventError{Type: "error", Message: "启动 claude session 失败: " + err.Error()})
		_ = c.Write(ctx, websocket.MessageText, data)
		_ = c.Close(websocket.StatusInternalError, "session start failed")
		return
	}
	defer h.manager.StopSession(c)

	sess.HandleWebSocket(ctx, c)
}
