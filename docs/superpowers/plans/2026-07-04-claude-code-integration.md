# Claude Code 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AKMDLibrary 中集成 Claude Code 助手：管理员配置 Claude 全局参数，每个 space 可独立启用，用户通过右下角悬浮按钮与 Claude 对话，后端按 WebSocket 连接管理 claude 子进程并自动处理工具权限。

**Architecture:** Docker entrypoint 创建/切换 Linux 用户、symlink data/claude 到 ~/.claude。后端用 `coder/websocket` 处理 WS 连接，每个连接 spawn 一个 claude 子进程（stream-json in/out，不带 partial messages）。权限判断在 control_request 到达时执行，结果直接以 control_response 写回 stdin，同时给前端推 permission_denied 事件。前端用 zustand 管 WS 状态，右下角悬浮按钮 + 可拖拽聊天面板。

**Tech Stack:** Go 1.25 / chi / SQLite / `github.com/coder/websocket` / React 18 / TypeScript / zustand / Tailwind

**Spec:** `docs/superpowers/specs/2026-07-04-claude-code-integration-design.md`

---

## 文件总览

### 新建（后端）
- `entrypoint.sh`（项目根）— Docker 容器入口
- `backend/internal/service/claude/protocol.go` — stream-json 消息结构定义
- `backend/internal/service/claude/permission.go` — 工具权限判断（含单元测试）
- `backend/internal/service/claude/permission_test.go` — 权限判断测试
- `backend/internal/service/claude/session.go` — 单个 claude 子进程封装
- `backend/internal/service/claude/manager.go` — `WS conn → session` 映射
- `backend/internal/service/claude/config.go` — 读写 data/claude/* 与 site_settings 的工具开关
- `backend/internal/handler/claude_handler.go` — admin config 接口 + WS handler

### 修改（后端）
- `Dockerfile` — 加 entrypoint、安装 CLI 占位、暴露环境变量
- `backend/internal/model/space.go` — `FeatureFlags.Claude`
- `backend/internal/middleware/feature_flag.go` — 新增 `RequireClaudeFeature`
- `backend/cmd/server/main.go` — 装配 claude handler/manager、注册路由、初始化 data/claude/

### 新建（前端）
- `frontend/src/api/claude.ts` — admin config API
- `frontend/src/hooks/useClaudeChat.ts` — WebSocket hook
- `frontend/src/components/ClaudeChat/FloatingButton.tsx`
- `frontend/src/components/ClaudeChat/ChatPanel.tsx`
- `frontend/src/components/ClaudeChat/MessageList.tsx`
- `frontend/src/components/ClaudeChat/MessageInput.tsx`
- `frontend/src/components/ClaudeChat/index.tsx` — 组合入口（FloatingButton + ChatPanel + 全局挂载逻辑）
- `frontend/src/components/ClaudeChat/styles.css` — 拖拽/动画相关

### 修改（前端）
- `frontend/src/api/spaces.ts` — `FeatureFlags` 加 `claude` 字段
- `frontend/src/pages/AdminPage.tsx` — 新 tab "Claude"、space 编辑面板加 Claude 复选框
- `frontend/src/components/Layout/Sidebar.tsx` — 新增 "Claude" nav 项
- `frontend/src/components/Layout/AppLayout.tsx` — 全局挂载 ClaudeChat 入口
- `frontend/src/api/client.ts` — WebSocket URL helper（如需）

---

## Phase 1: Docker Entrypoint

### Task 1: 创建 entrypoint.sh

**Files:**
- Create: `entrypoint.sh`

- [ ] **Step 1: 写 entrypoint.sh**

```sh
#!/bin/bash
set -e

# ===== 模式判断 =====
if [ -z "$USER_NAME" ] && [ -z "$USER_ID" ] && [ -z "$GROUP_NAME" ] && [ -z "$GROUP_ID" ]; then
    echo "[entrypoint] 未配置 USER_*/GROUP_* 环境变量，以当前用户直接启动"
    exec "$@"
fi

# 部分设置时拒绝启动
if [ -z "$USER_NAME" ] || [ -z "$USER_ID" ] || [ -z "$GROUP_NAME" ] || [ -z "$GROUP_ID" ]; then
    echo "错误: USER_NAME/USER_ID/GROUP_NAME/GROUP_ID 必须同时设置或同时留空" >&2
    exit 1
fi

echo "[entrypoint] 切换到用户 $USER_NAME (UID=$USER_ID) / 组 $GROUP_NAME (GID=$GROUP_ID)"

# ===== 创建/调整 group =====
if ! getent group "$GROUP_NAME" >/dev/null 2>&1; then
    groupadd -g "$GROUP_ID" "$GROUP_NAME"
    echo "[entrypoint] 创建组 $GROUP_NAME"
else
    groupmod -g "$GROUP_ID" "$GROUP_NAME"
fi

# ===== 创建/调整 user =====
HOME_DIR="/home/$USER_NAME"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    useradd -u "$USER_ID" -g "$GROUP_ID" -m -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
    echo "[entrypoint] 创建用户 $USER_NAME"
else
    usermod -u "$USER_ID" -g "$GROUP_ID" -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
fi

# ===== 建立 ~/.claude 软链（指向 data/claude，admin 改完立即生效） =====
mkdir -p "$HOME_DIR/.claude"
mkdir -p /app/data/claude

# settings.json symlink（不存在则先创建空骨架）
if [ ! -f /app/data/claude/settings.json ]; then
    echo '{ "env": {} }' > /app/data/claude/settings.json
fi
if [ ! -f /app/data/claude/system-prompt.md ]; then
    touch /app/data/claude/system-prompt.md
fi

rm -f "$HOME_DIR/.claude/settings.json"
ln -sf /app/data/claude/settings.json "$HOME_DIR/.claude/settings.json"

# ===== 修正权限（含 symlink 自身） =====
chown -h "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude/settings.json"
chown -R "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude"
chown -R "$USER_NAME:$GROUP_NAME" /app/data /app/docs

# ===== 切换用户后执行原 command =====
exec runuser -u "$USER_NAME" -- "$@"
```

- [ ] **Step 2: 赋可执行权限**

```bash
chmod +x entrypoint.sh
```

- [ ] **Step 3: 提交**

```bash
git add entrypoint.sh
git commit -m "feat(docker): add entrypoint.sh for runtime user switching"
```

---

### Task 2: 更新 Dockerfile

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: 读取现有 Dockerfile**

Run: `cat Dockerfile`

了解现有的最终 stage、`CMD`、`USER` 指令（如有）。

- [ ] **Step 2: 修改 Dockerfile**

在最终 stage 中：
1. 删除任何已有的 `USER` 指令（如果有）—— entrypoint 接管用户切换
2. `COPY entrypoint.sh /app/entrypoint.sh`
3. 添加注释占位 `# TODO: install claude code CLI (npm install -g @anthropic/claude-code)` 在最终 stage 顶部
4. 把 `ENTRYPOINT ["./server"]` 或类似改为：
   ```dockerfile
   COPY entrypoint.sh /app/entrypoint.sh
   RUN chmod +x /app/entrypoint.sh
   # CMD 形如 ["./server"] 或启动脚本
   ENTRYPOINT ["/app/entrypoint.sh"]
   CMD ["./server"]
   ```
5. 不设置 `USER` —— 容器以 root 启动，entrypoint 决定是否切换

- [ ] **Step 3: 本地构建验证**

```bash
docker build -t akmdlibrary:claude-test .
```

预期：构建成功。

- [ ] **Step 4: 运行验证（无环境变量模式）**

```bash
docker run --rm -e JWT_SECRET=test akmdlibrary:claude-test
```

预期：日志开头有 `[entrypoint] 未配置 USER_*/GROUP_* 环境变量`，然后正常启动后端。

- [ ] **Step 5: 运行验证（用户切换模式）**

```bash
docker run --rm -e JWT_SECRET=test \
  -e USER_NAME=akuser -e USER_ID=2000 \
  -e GROUP_NAME=akgroup -e GROUP_ID=2000 \
  akmdlibrary:claude-test
```

预期：日志显示创建用户、symlink、`exec runuser` 切换成功，后端正常启动。容器内 `id` 命令应显示 uid=2000。

- [ ] **Step 6: 提交**

```bash
git add Dockerfile
git commit -m "feat(docker): switch to entrypoint.sh-based user setup"
```

---

## Phase 2: Space Feature Flag — Claude

### Task 3: 后端 FeatureFlags 加 Claude 字段

**Files:**
- Modify: `backend/internal/model/space.go`

- [ ] **Step 1: 编辑 space.go**

找到 `FeatureFlags` struct（约 25 行附近），修改为：

```go
// FeatureFlags is the parsed shape of Space.FeatureFlags. Add new toggles
// here as fields; absent fields decode to their zero value (off).
type FeatureFlags struct {
	Git    bool `json:"git"`
	Claude bool `json:"claude"`
}
```

如果存在 `DefaultFeatureFlags()` 函数，相应更新：

```go
func DefaultFeatureFlags() FeatureFlags {
	return FeatureFlags{Git: false, Claude: false}
}
```

- [ ] **Step 2: 构建后端验证编译通过**

```bash
cd backend && go build ./...
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
git add backend/internal/model/space.go
git commit -m "feat(model): add Claude field to Space FeatureFlags"
```

---

### Task 4: 后端新增 RequireClaudeFeature middleware

**Files:**
- Modify: `backend/internal/middleware/feature_flag.go`

- [ ] **Step 1: 在 feature_flag.go 末尾追加**

```go
// RequireClaudeFeature returns 403 when the space's feature_flags.claude is false.
// Resolves the space from the URL's {slug} param.
func (m *FeatureFlagMiddleware) RequireClaudeFeature(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		if slug == "" {
			http.Error(w, "slug required", http.StatusBadRequest)
			return
		}

		space, err := m.spaceService.GetBySlug(slug)
		if err != nil {
			http.Error(w, "space not found", http.StatusNotFound)
			return
		}

		flags := space.ParseFeatureFlags()
		if !flags.Claude {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "claude feature disabled for this space",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 2: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 3: 提交**

```bash
git add backend/internal/middleware/feature_flag.go
git commit -m "feat(middleware): add RequireClaudeFeature"
```

---

### Task 5: 前端 FeatureFlags 类型加 claude

**Files:**
- Modify: `frontend/src/api/spaces.ts`

- [ ] **Step 1: 修改 FeatureFlags interface**

```typescript
export interface FeatureFlags {
  git: boolean;
  claude: boolean;
}
```

- [ ] **Step 2: 修复所有 `feature_flags: { git: false }` 默认值**

Run: `grep -rn "{ git: false }" frontend/src/`

每个匹配点改为 `{ git: false, claude: false }`。主要在 `AdminPage.tsx` 约 121、567、578 行附近。

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

预期：无错误（如果出现"property claude missing"，按提示补默认值）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api/spaces.ts frontend/src/pages/AdminPage.tsx
git commit -m "feat(frontend): add claude to FeatureFlags type"
```

---

### Task 6: AdminPage 空间编辑面板加 Claude 复选框

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 找到现有 Git 复选框位置**

Run: `grep -n "handleToggleGitFeature" frontend/src/pages/AdminPage.tsx`

预期：约 612 行有 `handleToggleGitFeature` 函数，约 1147 行有 Git 复选框 JSX。

- [ ] **Step 2: 在 handleToggleGitFeature 旁边加 handleToggleClaudeFeature**

```typescript
const handleToggleClaudeFeature = async (checked: boolean) => {
  if (!spacePanelSlug) return;
  const previous = spaceFormData.feature_flags;
  const updated = { ...spaceFormData.feature_flags, claude: checked };
  setSpaceFormData(prev => ({ ...prev, feature_flags: { ...prev.feature_flags, claude: checked } }));
  try {
    await spacesApi.updateFeatureFlags(spacePanelSlug, updated);
    setSpaces(prev => prev.map(s => s.slug === spacePanelSlug ? { ...s, feature_flags: updated } : s));
  } catch {
    setSpaceFormData(prev => ({ ...prev, feature_flags: previous }));
  }
};
```

- [ ] **Step 3: 在 Git 复选框 JSX 后面加 Claude 复选框**

找到（约 1142-1154 行）：
```jsx
{/* 功能开关（仅编辑模式） */}
{isEditing && (
  <div className="mb-3 pb-3 border-b border-notion-border">
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={spaceFormData.feature_flags?.git ?? false}
        onChange={(e) => handleToggleGitFeature(e.target.checked)}
        className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
      />
      <span className="text-sm text-notion-text">Git 管理</span>
    </label>
  </div>
)}
```

替换为：
```jsx
{/* 功能开关（仅编辑模式） */}
{isEditing && (
  <div className="mb-3 pb-3 border-b border-notion-border space-y-2">
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={spaceFormData.feature_flags?.git ?? false}
        onChange={(e) => handleToggleGitFeature(e.target.checked)}
        className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
      />
      <span className="text-sm text-notion-text">Git 管理</span>
    </label>
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={spaceFormData.feature_flags?.claude ?? false}
        onChange={(e) => handleToggleClaudeFeature(e.target.checked)}
        className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
      />
      <span className="text-sm text-notion-text">Claude 助手</span>
    </label>
  </div>
)}
```

- [ ] **Step 4: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: 手动验证（启动前后端）**

启动后端：`cd backend && go run ./cmd/server`
启动前端：`cd frontend && npm run dev`

以 admin 登录 → 空间管理 → 展开某 space → 应看到「Claude 助手」复选框。勾选/取消，刷新后状态保持。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): add Claude feature flag checkbox in space panel"
```

---

## Phase 3: Claude 配置存储 + 管理员 API

### Task 7: 后端 claude config 模型与 service

**Files:**
- Create: `backend/internal/service/claude/config.go`

- [ ] **Step 1: 创建 config.go**

```go
package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/alwaysking/akmdlibrary/internal/repository"
)

// ToolConfig 是 site_settings 里 claude_tool_config 键的 JSON 内容。
type ToolConfig struct {
	AllowBash bool `json:"allow_bash"`
	AllowWeb  bool `json:"allow_web"`
}

// AdminConfig 是管理员后台 Claude 页面读写完整配置的载体。
type AdminConfig struct {
	SettingsJSON  map[string]any `json:"settings_json"`
	SystemPrompt  string         `json:"system_prompt"`
	ToolConfig    ToolConfig     `json:"tool_config"`
}

// ConfigStore 管理 data/claude/* 文件 + site_settings 中的 tool_config 键。
type ConfigStore struct {
	mu              sync.Mutex
	dataClaudeDir   string // 通常 /app/data/claude
	settingsRepo    *repository.SiteSettingRepository
}

func NewConfigStore(dataDir string, repo *repository.SiteSettingRepository) *ConfigStore {
	dir := filepath.Join(dataDir, "claude")
	os.MkdirAll(dir, 0755)
	return &ConfigStore{dataClaudeDir: dir, settingsRepo: repo}
}

// EnsureDefaults 启动时调用：保证骨架文件存在。
func (s *ConfigStore) EnsureDefaults() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sj := filepath.Join(s.dataClaudeDir, "settings.json")
	if _, err := os.Stat(sj); os.IsNotExist(err) {
		if err := os.WriteFile(sj, []byte("{\n  \"env\": {}\n}\n"), 0644); err != nil {
			return err
		}
	}
	sp := filepath.Join(s.dataClaudeDir, "system-prompt.md")
	if _, err := os.Stat(sp); os.IsNotExist(err) {
		if err := os.WriteFile(sp, []byte(""), 0644); err != nil {
			return err
		}
	}
	return nil
}

// Load 读出完整管理员配置。
func (s *ConfigStore) Load() (*AdminConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg := &AdminConfig{}

	// settings.json
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "settings.json"))
	if err != nil {
		return nil, fmt.Errorf("read settings.json: %w", err)
	}
	var settings map[string]any
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil, fmt.Errorf("parse settings.json: %w", err)
	}
	cfg.SettingsJSON = settings

	// system prompt
	sp, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"))
	if err != nil {
		return nil, fmt.Errorf("read system-prompt.md: %w", err)
	}
	cfg.SystemPrompt = string(sp)

	// tool config
	tcRaw, err := s.settingsRepo.Get("claude_tool_config")
	if err != nil {
		return nil, fmt.Errorf("load tool_config: %w", err)
	}
	if tcRaw == "" {
		cfg.ToolConfig = ToolConfig{}
	} else if err := json.Unmarshal([]byte(tcRaw), &cfg.ToolConfig); err != nil {
		return nil, fmt.Errorf("parse tool_config: %w", err)
	}
	return cfg, nil
}

// Save 写入完整管理员配置。
func (s *ConfigStore) Save(cfg *AdminConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// settings.json
	raw, err := json.MarshalIndent(cfg.SettingsJSON, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.dataClaudeDir, "settings.json"), raw, 0644); err != nil {
		return fmt.Errorf("write settings.json: %w", err)
	}

	// system prompt
	if err := os.WriteFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"), []byte(cfg.SystemPrompt), 0644); err != nil {
		return fmt.Errorf("write system-prompt.md: %w", err)
	}

	// tool config
	tcRaw, err := json.Marshal(cfg.ToolConfig)
	if err != nil {
		return fmt.Errorf("marshal tool_config: %w", err)
	}
	if err := s.settingsRepo.Set("claude_tool_config", string(tcRaw)); err != nil {
		return fmt.Errorf("save tool_config: %w", err)
	}
	return nil
}

// LoadToolConfig 只读 tool_config（每个 claude session 启动时用）。
func (s *ConfigStore) LoadToolConfig() ToolConfig {
	cfg, err := s.Load()
	if err != nil || cfg == nil {
		return ToolConfig{}
	}
	return cfg.ToolConfig
}

// LoadSystemPrompt 只读 system-prompt.md（每个 claude session 启动时用）。
func (s *ConfigStore) LoadSystemPrompt() string {
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "system-prompt.md"))
	if err != nil {
		return ""
	}
	return string(raw)
}

// LoadSettingsEnv 读 settings.json 中的 env 字段（用于 spawn claude 时注入环境变量）。
// 如果 settings.json 整体非法或 env 缺失，返回空 map。
func (s *ConfigStore) LoadSettingsEnv() map[string]string {
	raw, err := os.ReadFile(filepath.Join(s.dataClaudeDir, "settings.json"))
	if err != nil {
		return map[string]string{}
	}
	var parsed struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return map[string]string{}
	}
	if parsed.Env == nil {
		return map[string]string{}
	}
	return parsed.Env
}
```

- [ ] **Step 2: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 3: 提交**

```bash
git add backend/internal/service/claude/config.go
git commit -m "feat(claude): add ConfigStore for admin config persistence"
```

---

### Task 8: main.go 初始化 ConfigStore

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: 引入 claude service 包**

在 import 块的 `service` 后面添加：
```go
"github.com/alwaysking/akmdlibrary/internal/service"
"github.com/alwaysking/akmdlibrary/internal/service/claude"
```

- [ ] **Step 2: 在 siteSettingService 创建后加 ConfigStore**

找到约 89 行 `siteSettingService := service.NewSiteSettingService(siteSettingRepo)`，在其后追加：

```go
// Claude config store
claudeConfigStore := claude.NewConfigStore(dataDir, siteSettingRepo)
if err := claudeConfigStore.EnsureDefaults(); err != nil {
	log.Printf("Warning: failed to init claude config: %v", err)
}
```

- [ ] **Step 3: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 4: 运行验证（启动后端，确认骨架文件被创建）**

```bash
rm -rf userdata/data/claude
cd backend && go run ./cmd/server &
# 等待 2 秒后检查
ls userdata/data/claude/
kill %1
```

预期：输出 `settings.json` 和 `system-prompt.md`。

- [ ] **Step 5: 提交**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(main): initialize claude ConfigStore on startup"
```

---

### Task 9: 管理员 Claude 配置 HTTP 接口

**Files:**
- Create: `backend/internal/handler/claude_handler.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: 创建 claude_handler.go（admin config 部分，WS 部分后续任务加）**

```go
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/alwaysking/akmdlibrary/internal/service/claude"
)

type ClaudeHandler struct {
	config *claude.ConfigStore
}

func NewClaudeHandler(config *claude.ConfigStore) *ClaudeHandler {
	return &ClaudeHandler{config: config}
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
	// 校验 settings.json 必须可序列化为合法 JSON（已经 map[string]any，自然合法）
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
```

- [ ] **Step 2: 在 main.go 装配 handler 并注册路由**

在 `claudeConfigStore` 创建后追加（约 main.go 第 90 行附近）：
```go
claudeHandler := handler.NewClaudeHandler(claudeConfigStore)
```

在 `RequireAdmin` group 内部（约 222-235 行）添加两条路由：
```go
r.Group(func(r chi.Router) {
	r.Use(authMiddleware.RequireAdmin)
	// ...existing routes...
	r.Get("/api/admin/claude/config", claudeHandler.GetConfig)
	r.Put("/api/admin/claude/config", claudeHandler.UpdateConfig)
})
```

- [ ] **Step 3: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 4: 接口冒烟测试**

启动后端，用 admin token 测试：
```bash
# 获取 token（替换实际用户名密码）
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# GET
curl -s http://localhost:8080/api/admin/claude/config \
  -H "Authorization: Bearer $TOKEN" | jq

# PUT
curl -s -X PUT http://localhost:8080/api/admin/claude/config \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "settings_json": {"env": {"ANTHROPIC_AUTH_TOKEN": "test"}},
    "system_prompt": "你是助手",
    "tool_config": {"allow_bash": false, "allow_web": false}
  }' | jq
```

预期：GET 返回 `settings_json/system_prompt/tool_config`；PUT 返回 `{"ok": true}`；之后再 GET 看到更新后的内容。

- [ ] **Step 5: 提交**

```bash
git add backend/internal/handler/claude_handler.go backend/cmd/server/main.go
git commit -m "feat(handler): add admin Claude config endpoints"
```

---

## Phase 4: 前端管理员 Claude 配置 UI

### Task 10: 前端 claude API client

**Files:**
- Create: `frontend/src/api/claude.ts`

- [ ] **Step 1: 创建 claude.ts**

```typescript
import apiClient from './client';

export interface ClaudeToolConfig {
  allow_bash: boolean;
  allow_web: boolean;
}

export interface ClaudeAdminConfig {
  settings_json: Record<string, any>;
  system_prompt: string;
  tool_config: ClaudeToolConfig;
}

export const claudeApi = {
  getConfig: async (): Promise<ClaudeAdminConfig> => {
    const response = await apiClient.get<ClaudeAdminConfig>('/admin/claude/config');
    return response.data;
  },

  updateConfig: async (config: ClaudeAdminConfig): Promise<void> => {
    await apiClient.put('/admin/claude/config', config);
  },
};
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/claude.ts
git commit -m "feat(api): add claude admin config client"
```

---

### Task 11: AdminPage 新增 Claude tab

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 添加 imports**

文件顶部 import 区添加：
```typescript
import { claudeApi, ClaudeAdminConfig } from '../api/claude';
```

- [ ] **Step 2: 添加状态变量**

在站点设置状态块（约 153 行附近）后追加：
```typescript
// ---- Claude 配置状态 ----
const [claudeConfig, setClaudeConfig] = useState<ClaudeAdminConfig | null>(null);
const [claudeEnvToken, setClaudeEnvToken] = useState('');
const [claudeEnvBaseUrl, setClaudeEnvBaseUrl] = useState('');
const [claudeEnvModel, setClaudeEnvModel] = useState('');
const [claudeSettingsRaw, setClaudeSettingsRaw] = useState('');
const [claudeSettingsError, setClaudeSettingsError] = useState('');
const [claudeSystemPrompt, setClaudeSystemPrompt] = useState('');
const [claudeAllowBash, setClaudeAllowBash] = useState(false);
const [claudeAllowWeb, setClaudeAllowWeb] = useState(false);
const [claudeSaving, setClaudeSaving] = useState(false);
const [claudeMsg, setClaudeMsg] = useState('');
```

- [ ] **Step 3: 添加加载 effect**

在站点设置 effect（约 291 行）后追加：
```typescript
// 加载 Claude 配置
useEffect(() => {
  if (activeTab !== 'claude') return;
  claudeApi.getConfig().then(cfg => {
    setClaudeConfig(cfg);
    setClaudeEnvToken(cfg.settings_json?.env?.ANTHROPIC_AUTH_TOKEN ?? '');
    setClaudeEnvBaseUrl(cfg.settings_json?.env?.ANTHROPIC_BASE_URL ?? '');
    setClaudeEnvModel(cfg.settings_json?.env?.ANTHROPIC_MODEL ?? '');
    setClaudeSettingsRaw(JSON.stringify(cfg.settings_json ?? {}, null, 2));
    setClaudeSystemPrompt(cfg.system_prompt ?? '');
    setClaudeAllowBash(cfg.tool_config?.allow_bash ?? false);
    setClaudeAllowWeb(cfg.tool_config?.allow_web ?? false);
  }).catch(() => setClaudeMsg('加载 Claude 配置失败'));
}, [activeTab]);
```

- [ ] **Step 4: 添加同步函数（env → raw JSON）**

```typescript
const syncEnvToSettings = (key: string, value: string) => {
  // 把 env 三个高亮字段同步回 raw JSON
  try {
    const parsed = JSON.parse(claudeSettingsRaw || '{}');
    if (!parsed.env) parsed.env = {};
    parsed.env[key] = value;
    setClaudeSettingsRaw(JSON.stringify(parsed, null, 2));
    setClaudeSettingsError('');
  } catch (e: any) {
    setClaudeSettingsError('settings.json 不是合法 JSON，无法自动合并 env');
  }
};
```

- [ ] **Step 5: 添加保存函数**

```typescript
const handleSaveClaudeConfig = async () => {
  setClaudeSaving(true);
  setClaudeMsg('');
  try {
    let parsedSettings: Record<string, any>;
    try {
      parsedSettings = JSON.parse(claudeSettingsRaw || '{}');
    } catch {
      throw new Error('settings.json 不是合法 JSON');
    }
    const cfg: ClaudeAdminConfig = {
      settings_json: parsedSettings,
      system_prompt: claudeSystemPrompt,
      tool_config: { allow_bash: claudeAllowBash, allow_web: claudeAllowWeb },
    };
    await claudeApi.updateConfig(cfg);
    setClaudeConfig(cfg);
    setClaudeMsg('已保存');
  } catch (e: any) {
    setClaudeMsg(e.message || '保存失败');
  } finally {
    setClaudeSaving(false);
  }
};
```

- [ ] **Step 6: 添加 renderClaudeConfig 函数**

参考其他 `renderXxx` 函数的位置，添加：
```typescript
const renderClaudeConfig = () => {
  return (
    <>
      <h1 className="text-xl font-semibold text-notion-text mb-6">Claude 助手配置</h1>
      <div className="space-y-6">
        {/* 环境变量快速配置 */}
        <section className="bg-white rounded-lg p-5 border border-notion-border">
          <h2 className="text-sm font-medium text-notion-text mb-3">环境变量（写入 settings.json.env）</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-notion-textSecondary mb-1">ANTHROPIC_AUTH_TOKEN</label>
              <input
                type="password"
                value={claudeEnvToken}
                onChange={(e) => { setClaudeEnvToken(e.target.value); syncEnvToSettings('ANTHROPIC_AUTH_TOKEN', e.target.value); }}
                className="w-full px-3 py-2 border border-notion-border rounded text-sm font-mono"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs text-notion-textSecondary mb-1">ANTHROPIC_BASE_URL</label>
              <input
                type="text"
                value={claudeEnvBaseUrl}
                onChange={(e) => { setClaudeEnvBaseUrl(e.target.value); syncEnvToSettings('ANTHROPIC_BASE_URL', e.target.value); }}
                className="w-full px-3 py-2 border border-notion-border rounded text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-notion-textSecondary mb-1">ANTHROPIC_MODEL</label>
              <input
                type="text"
                value={claudeEnvModel}
                onChange={(e) => { setClaudeEnvModel(e.target.value); syncEnvToSettings('ANTHROPIC_MODEL', e.target.value); }}
                className="w-full px-3 py-2 border border-notion-border rounded text-sm font-mono"
              />
            </div>
          </div>
        </section>

        {/* settings.json 完整编辑 */}
        <section className="bg-white rounded-lg p-5 border border-notion-border">
          <h2 className="text-sm font-medium text-notion-text mb-3">settings.json 完整内容</h2>
          <textarea
            value={claudeSettingsRaw}
            onChange={(e) => setClaudeSettingsRaw(e.target.value)}
            rows={12}
            className="w-full px-3 py-2 border border-notion-border rounded text-xs font-mono"
            spellCheck={false}
          />
          {claudeSettingsError && (
            <div className="text-xs text-red-600 mt-1">{claudeSettingsError}</div>
          )}
        </section>

        {/* 系统提示词 */}
        <section className="bg-white rounded-lg p-5 border border-notion-border">
          <h2 className="text-sm font-medium text-notion-text mb-3">默认系统提示词</h2>
          <textarea
            value={claudeSystemPrompt}
            onChange={(e) => setClaudeSystemPrompt(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-notion-border rounded text-sm"
            placeholder="每次会话启动时通过 --append-system-prompt 传给 Claude"
          />
        </section>

        {/* 工具权限开关 */}
        <section className="bg-white rounded-lg p-5 border border-notion-border">
          <h2 className="text-sm font-medium text-notion-text mb-3">工具权限</h2>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={claudeAllowBash}
                onChange={(e) => setClaudeAllowBash(e.target.checked)}
                className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
              />
              <span className="text-sm text-notion-text">允许 Bash 工具（默认拒绝，启用前请评估风险）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={claudeAllowWeb}
                onChange={(e) => setClaudeAllowWeb(e.target.checked)}
                className="w-4 h-4 rounded border-notion-border text-notion-text focus:ring-blue-500"
              />
              <span className="text-sm text-notion-text">允许网络工具（WebSearch / WebFetch）</span>
            </label>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveClaudeConfig}
            disabled={claudeSaving}
            className="px-4 py-2 bg-notion-text text-white rounded text-sm hover:bg-notion-text/90 disabled:opacity-50"
          >
            {claudeSaving ? '保存中...' : '保存'}
          </button>
          {claudeMsg && (
            <span className={`text-sm ${claudeMsg.includes('失败') || claudeMsg.includes('合法') ? 'text-red-600' : 'text-green-600'}`}>
              {claudeMsg}
            </span>
          )}
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 7: 在主 render 切换中接入 Claude tab**

找到（约 2075-2076 行）：
```jsx
{(activeTab === 'users' || activeTab === 'spaces') && !isAdminUser ? renderProfile() :
  activeTab === 'users' ? renderUsers() : activeTab === 'spaces' ? renderSpaces() : activeTab === 'resources' ? renderResources() : activeTab === 'site' ? renderSiteSettings() : renderProfile()}
```

替换为：
```jsx
{(activeTab === 'users' || activeTab === 'spaces') && !isAdminUser ? renderProfile() :
  activeTab === 'users' ? renderUsers() :
  activeTab === 'spaces' ? renderSpaces() :
  activeTab === 'resources' ? renderResources() :
  activeTab === 'site' ? renderSiteSettings() :
  activeTab === 'claude' ? (isAdminUser ? renderClaudeConfig() : renderProfile()) :
  renderProfile()}
```

- [ ] **Step 8: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 9: 提交**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): add Claude configuration tab"
```

---

### Task 12: Sidebar 添加 Claude nav 项

**Files:**
- Modify: `frontend/src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: 找到 nav 项 import**

Run: `grep -n "from 'lucide-react'" frontend/src/components/Layout/Sidebar.tsx`

确认导入 lucide 图标的方式。

- [ ] **Step 2: 引入 Bot 图标**

在 lucide-react import 中追加 `Bot`：
```typescript
import { Settings, User, Users, Database, Image, Bot, /* ...existing */ } from 'lucide-react';
```

- [ ] **Step 3: 在「站点设置」按钮后追加 Claude nav 项**

找到（约 107-118 行）：
```jsx
{isAdminRole && (
  <button
    onClick={() => navigate('/admin?tab=site')}
    className={...}
  >
    <Settings className="w-4 h-4" />
    <span>站点设置</span>
  </button>
)}
```

替换为：
```jsx
{isAdminRole && (
  <>
    <button
      onClick={() => navigate('/admin?tab=site')}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
        adminTab === 'site'
          ? 'bg-notion-hover text-notion-text font-medium'
          : 'text-notion-text hover:bg-notion-hover'
      }`}
    >
      <Settings className="w-4 h-4" />
      <span>站点设置</span>
    </button>
    <button
      onClick={() => navigate('/admin?tab=claude')}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
        adminTab === 'claude'
          ? 'bg-notion-hover text-notion-text font-medium'
          : 'text-notion-text hover:bg-notion-hover'
      }`}
    >
      <Bot className="w-4 h-4" />
      <span>Claude</span>
    </button>
  </>
)}
```

- [ ] **Step 4: 手动验证**

启动前端，以 admin 登录 → 进入设置 → 应看到「Claude」nav 项，点击进入 Claude 配置页。保存后端配置（前一个 Task 的步骤 4 已验证 API）应能成功。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/Layout/Sidebar.tsx
git commit -m "feat(sidebar): add Claude nav item for admin"
```

---

## Phase 5: 后端 Claude Session + WebSocket

### Task 13: 添加 coder/websocket 依赖

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: 添加依赖**

```bash
cd backend && go get github.com/coder/websocket@latest
```

- [ ] **Step 2: 验证 go.mod 更新**

```bash
grep coder/websocket backend/go.mod
```

预期：看到一行 `github.com/coder/websocket v1.x.x`。

- [ ] **Step 3: 提交**

```bash
git add backend/go.mod backend/go.sum
git commit -m "deps: add github.com/coder/websocket"
```

---

### Task 14: claude/protocol.go —— stream-json 消息结构

**Files:**
- Create: `backend/internal/service/claude/protocol.go`

- [ ] **Step 1: 创建 protocol.go**

```go
package claude

import "encoding/json"

// ===== stdin 消息（后端 → claude） =====

// UserMessage 是发给 claude stdin 的用户消息。
type UserMessage struct {
	Type    string          `json:"type"` // 固定 "user"
	Message json.RawMessage `json:"message"`
}

func NewUserMessage(text string) *UserMessage {
	body := map[string]any{
		"role": "user",
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
	}
	raw, _ := json.Marshal(body)
	return &UserMessage{Type: "user", Message: raw}
}

// ControlResponse 是回答 claude 权限请求的应答。
type ControlResponse struct {
	Type     string                 `json:"type"` // 固定 "control_response"
	Response map[string]any         `json:"response"`
}

func NewControlResponse(requestID string, allowed bool, reason string) *ControlResponse {
	behavior := "allow"
	if !allowed {
		behavior = "deny"
	}
	resp := map[string]any{
		"subtype":    "success",
		"request_id": requestID,
		"response": map[string]any{
			"behavior": behavior,
		},
	}
	if !allowed {
		resp["response"].(map[string]any)["message"] = reason
	}
	return &ControlResponse{Type: "control_response", Response: resp}
}

// ===== stdout 消息（claude → 后端） =====

// AssistantMessage 是 claude 完整生成的一条 assistant 消息。
type AssistantMessage struct {
	Type    string `json:"type"` // "assistant"
	Message struct {
		Role    string            `json:"role"`
		Content []json.RawMessage `json:"content"` // 每个元素是 {type: text|tool_use|...}
	} `json:"message"`
}

// AssistantTextBlock 是 assistant 消息里 type=text 的 content 元素。
type AssistantTextBlock struct {
	Type string `json:"type"` // "text"
	Text string `json:"text"`
}

// ExtractText 把 assistant message 的所有 text block 拼接出来。
func (m *AssistantMessage) ExtractText() string {
	var out string
	for _, raw := range m.Message.Content {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			continue
		}
		if probe.Type != "text" {
			continue
		}
		var tb AssistantTextBlock
		if err := json.Unmarshal(raw, &tb); err == nil {
			out += tb.Text
		}
	}
	return out
}

// ControlRequest 是 claude 请求权限的工具调用。
type ControlRequest struct {
	Type        string `json:"type"` // "control_request"
	RequestID   string `json:"request_id"`
	Request     struct {
		ToolName string                 `json:"tool_name"`
		Input    map[string]any         `json:"input"`
	} `json:"request"`
}

// ===== 前端协议（后端 → 前端 WS 帧） =====

type EventStatus struct {
	Type   string `json:"type"`   // "status"
	Status string `json:"status"` // "answering" | "idle"
}

type EventAssistantMessage struct {
	Type    string `json:"type"`    // "assistant_message"
	Content string `json:"content"`
}

type EventPermissionDenied struct {
	Type   string `json:"type"`   // "permission_denied"
	Tool   string `json:"tool"`
	Path   string `json:"path,omitempty"`
	Reason string `json:"reason"`
}

type EventError struct {
	Type    string `json:"type"`    // "error"
	Message string `json:"message"`
}

// ===== 前端协议（前端 → 后端 WS 帧） =====

type ClientMessage struct {
	Type    string `json:"type"`    // "user_message"
	Content string `json:"content"`
}
```

- [ ] **Step 2: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 3: 提交**

```bash
git add backend/internal/service/claude/protocol.go
git commit -m "feat(claude): add stream-json protocol definitions"
```

---

### Task 15: claude/permission.go —— 权限判断

**Files:**
- Create: `backend/internal/service/claude/permission.go`
- Create: `backend/internal/service/claude/permission_test.go`

- [ ] **Step 1: 创建 permission.go**

```go
package claude

import (
	"path/filepath"
	"strings"
)

// PermissionInput 是权限判断的输入。
type PermissionInput struct {
	ToolName        string                 // Read / Write / Bash / ...
	ToolInput       map[string]any         // 工具参数原始 map
	UserCanWrite    bool                   // 用户对该 space 是否有写权限
	SpaceDir        string                 // space 绝对路径（resolve 后）
	ToolConfig      ToolConfig             // 全局工具开关
}

// PermissionResult 是权限判断的输出。
type PermissionResult struct {
	Allowed bool
	Reason  string
	Path    string // 用于前端展示，可能为空
}

// Check 实施权限判断。
func Check(in PermissionInput) PermissionResult {
	switch in.ToolName {
	case "Bash":
		if !in.ToolConfig.AllowBash {
			return PermissionResult{Allowed: false, Reason: "Bash 工具已被全局禁用"}
		}
		return PermissionResult{Allowed: true}

	case "WebSearch", "WebFetch":
		if !in.ToolConfig.AllowWeb {
			return PermissionResult{Allowed: false, Reason: "网络工具已被全局禁用"}
		}
		return PermissionResult{Allowed: true}

	case "Read", "Glob", "Grep":
		rawPath := extractReadPath(in.ToolName, in.ToolInput)
		if rawPath == "" {
			return PermissionResult{Allowed: true} // 没有路径字段（罕见），不阻断
		}
		if !isPathInsideSpace(rawPath, in.SpaceDir) {
			return PermissionResult{Allowed: false, Reason: "路径不在当前空间范围内: " + rawPath, Path: rawPath}
		}
		return PermissionResult{Allowed: true, Path: rawPath}

	case "Write", "Edit", "MultiEdit":
		if !in.UserCanWrite {
			return PermissionResult{Allowed: false, Reason: "当前用户在该空间没有写权限"}
		}
		rawPath, _ := in.ToolInput["file_path"].(string)
		if rawPath == "" {
			return PermissionResult{Allowed: false, Reason: "缺少 file_path 参数"}
		}
		if !isPathInsideSpace(rawPath, in.SpaceDir) {
			return PermissionResult{Allowed: false, Reason: "路径不在当前空间范围内: " + rawPath, Path: rawPath}
		}
		return PermissionResult{Allowed: true, Path: rawPath}

	default:
		// TodoWrite、Task 等无副作用工具一律 allow
		return PermissionResult{Allowed: true}
	}
}

// extractReadPath 从 Read/Glob/Grep 的 input 里抽出要校验的路径字段。
func extractReadPath(toolName string, input map[string]any) string {
	if input == nil {
		return ""
	}
	// Read: file_path
	if v, ok := input["file_path"].(string); ok && v != "" {
		return v
	}
	// Glob: pattern（用 pattern 的目录部分校验）；Grep: path 或 cwd
	if v, ok := input["path"].(string); ok && v != "" {
		return v
	}
	if v, ok := input["cwd"].(string); ok && v != "" {
		return v
	}
	return ""
}

// isPathInsideSpace 判断 rawPath（可能是相对/绝对路径）解析后是否落在 spaceDir 内。
// 不跟随 symlink（symlink 可能逃逸到 space 外）。
func isPathInsideSpace(rawPath, spaceDir string) bool {
	if rawPath == "" {
		return false
	}
	abs := rawPath
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(spaceDir, abs)
	}
	abs = filepath.Clean(abs)
	spaceDirClean := filepath.Clean(spaceDir)
	if abs == spaceDirClean {
		return true
	}
	return strings.HasPrefix(abs, spaceDirClean+string(filepath.Separator))
}
```

- [ ] **Step 2: 创建 permission_test.go**

```go
package claude

import (
	"path/filepath"
	"testing"
)

func TestIsPathInsideSpace_AbsoluteInside(t *testing.T) {
	if !isPathInsideSpace("/app/docs/demo/note.md", "/app/docs/demo") {
		t.Error("absolute path inside space should be allowed")
	}
}

func TestIsPathInsideSpace_RelativeInside(t *testing.T) {
	if !isPathInsideSpace("note.md", "/app/docs/demo") {
		t.Error("relative path inside space should be allowed")
	}
	if !isPathInsideSpace("sub/note.md", "/app/docs/demo") {
		t.Error("relative subpath inside space should be allowed")
	}
}

func TestIsPathInsideSpace_ParentEscape(t *testing.T) {
	if isPathInsideSpace("../secret/demo.md", "/app/docs/demo") {
		t.Error("parent escape should be denied")
	}
	if isPathInsideSpace("/app/docs/other/note.md", "/app/docs/demo") {
		t.Error("sibling space should be denied")
	}
}

func TestIsPathInsideSpace_EdgeCases(t *testing.T) {
	// 路径等于 spaceDir 本身（例如 Glob 根）
	if !isPathInsideSpace("/app/docs/demo", "/app/docs/demo") {
		t.Error("space dir itself should be allowed")
	}
	// 前缀匹配陷阱：/app/docs/demoX 不应被误判为 /app/docs/demo 子路径
	if isPathInsideSpace("/app/docs/demoX/note.md", "/app/docs/demo") {
		t.Error("prefix-similar path should be denied (no separator)")
	}
}

func TestCheck_ReadAllowsInsidePath(t *testing.T) {
	r := Check(PermissionInput{
		ToolName: "Read",
		ToolInput: map[string]any{"file_path": "/app/docs/demo/note.md"},
		SpaceDir: "/app/docs/demo",
	})
	if !r.Allowed {
		t.Errorf("expected allow, got deny: %s", r.Reason)
	}
}

func TestCheck_ReadDeniesOutsidePath(t *testing.T) {
	r := Check(PermissionInput{
		ToolName: "Read",
		ToolInput: map[string]any{"file_path": "/etc/passwd"},
		SpaceDir: "/app/docs/demo",
	})
	if r.Allowed {
		t.Error("expected deny for path outside space")
	}
}

func TestCheck_WriteRequiresPermission(t *testing.T) {
	// viewer 写 → 拒
	r := Check(PermissionInput{
		ToolName: "Write",
		ToolInput: map[string]any{"file_path": "/app/docs/demo/note.md"},
		UserCanWrite: false,
		SpaceDir: "/app/docs/demo",
	})
	if r.Allowed {
		t.Error("viewer write should be denied")
	}
	// editor 写空间内 → 许可
	r = Check(PermissionInput{
		ToolName: "Write",
		ToolInput: map[string]any{"file_path": "/app/docs/demo/note.md"},
		UserCanWrite: true,
		SpaceDir: "/app/docs/demo",
	})
	if !r.Allowed {
		t.Errorf("editor write inside space should be allowed: %s", r.Reason)
	}
}

func TestCheck_BashDefault(t *testing.T) {
	r := Check(PermissionInput{ToolName: "Bash", ToolConfig: ToolConfig{}})
	if r.Allowed {
		t.Error("Bash should be denied by default")
	}
	r = Check(PermissionInput{ToolName: "Bash", ToolConfig: ToolConfig{AllowBash: true}})
	if !r.Allowed {
		t.Error("Bash should be allowed when toggle on")
	}
}

func TestCheck_UnknownToolAllowed(t *testing.T) {
	r := Check(PermissionInput{ToolName: "TodoWrite"})
	if !r.Allowed {
		t.Error("side-effect-free tools should be allowed by default")
	}
}

func TestSpaceDirResolution(t *testing.T) {
	// 用 filepath.Join 测试相对路径解析的稳健性
	spaceDir := filepath.Clean("/app/docs/demo")
	if !isPathInsideSpace(filepath.Join(spaceDir, "a/b.md"), spaceDir) {
		t.Error("joined subpath should be inside")
	}
}
```

- [ ] **Step 3: 运行测试**

```bash
cd backend && go test ./internal/service/claude/... -v
```

预期：所有测试通过。

- [ ] **Step 4: 提交**

```bash
git add backend/internal/service/claude/permission.go backend/internal/service/claude/permission_test.go
git commit -m "feat(claude): add tool permission logic with tests"
```

---

### Task 16: claude/session.go —— 单个 claude 子进程

**Files:**
- Create: `backend/internal/service/claude/session.go`

- [ ] **Step 1: 创建 session.go**

```go
package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"path/filepath"
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
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     io.ReadCloser
	stdoutMu   sync.Mutex // 保护 stdin 写入
	wg         sync.WaitGroup
	cancel     context.CancelFunc
	spaceDir   string
	userWrite  bool
	toolCfg    ToolConfig
	sysPrompt  string
	envOverrides map[string]string
	callbacks  SessionCallbacks
}

type SessionParams struct {
	SpaceDir      string                 // 子进程 cwd
	EnvOverrides  map[string]string      // settings.json.env 的覆盖
	SystemPrompt  string
	UserCanWrite  bool
	ToolConfig    ToolConfig
	Callbacks     SessionCallbacks
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
```

- [ ] **Step 2: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 3: 提交**

```bash
git add backend/internal/service/claude/session.go
git commit -m "feat(claude): add Session to wrap claude subprocess"
```

---

### Task 17: claude/manager.go —— WS 连接 → session 映射

**Files:**
- Create: `backend/internal/service/claude/manager.go`

- [ ] **Step 1: 创建 manager.go**

```go
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

// Manager 持有所有运行中 session 的引用 + 启动 session 所需依赖。
type Manager struct {
	mu          sync.Mutex
	sessions    map[*websocket.Conn]*Session
	config      *ConfigStore
	memberRepo  *repository.MemberRepository
	spaceRepo   *repository.SpaceRepository
	authService interface{ VerifyToken(string) (int, error) } // AuthService 满足此签名即可
	docsDir     string
}

// NewManager 构造 manager。authService 通常传 *service.AuthService。
func NewManager(
	config *ConfigStore,
	memberRepo *repository.MemberRepository,
	spaceRepo *repository.SpaceRepository,
	authService interface{ VerifyToken(string) (int, error) },
	docsDir string,
) *Manager {
	return &Manager{
		sessions:    map[*websocket.Conn]*Session{},
		config:      config,
		memberRepo:  memberRepo,
		spaceRepo:   spaceRepo,
		authService: authService,
		docsDir:     docsDir,
	}
}

// VerifyToken 暴露给 handler 校验 JWT。
func (m *Manager) VerifyToken(token string) (int, error) {
	return m.authService.VerifyToken(token)
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
	member, err := m.memberRepo.FindByUserAndSpace(userID, space.ID)
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
```

注意：`claudePath` 在 session.go 里直接用 `"claude"`（依赖子进程 PATH）。如果需要细化路径扫描，后续单独迭代。

**注意 Repository 方法名**：上面用了 `spaceRepo.GetBySlug` 与 `memberRepo.FindByUserAndSpace`。运行 `grep -n "func .*Repository.*GetBySlug\|func .*Repository.*FindByUserAndSpace\|func .*Member" backend/internal/repository/*.go` 确认实际方法名。若不一致，按实际名调整 `ResolveSpaceAndPermission` 调用；若 member repo 没有 `FindByUserAndSpace`，先按实际名（如 `GetByUserAndSpace`）替换。

- [ ] **Step 2: 构建验证**

```bash
cd backend && go build ./...
```

如果有未使用 import 报错，移除。

- [ ] **Step 3: 提交**

```bash
git add backend/internal/service/claude/manager.go
git commit -m "feat(claude): add Manager for WS session lifecycle"
```

---

### Task 18: claude_handler.go 加 WS handler + main.go 装配

**Files:**
- Modify: `backend/internal/handler/claude_handler.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: 确认 repository 方法名**

Run: `grep -n "func .*GetBySlug\|func .*Member\|func .*UserAndSpace\|func .*SpaceMember" backend/internal/repository/*.go`

记下：
- `spaceRepo` 取 space 的方法名（可能 `GetBySlug`）
- `memberRepo` 取成员的方法名（可能 `GetByUserAndSpace` / `FindByUserAndSpace`）

如与 manager.go（Task 17）中 `ResolveSpaceAndPermission` 使用的不一致，先在 manager.go 改对。

- [ ] **Step 2: 修改 ClaudeHandler struct，加 manager 字段**

把 Task 9 创建的：
```go
type ClaudeHandler struct {
	config *claude.ConfigStore
}

func NewClaudeHandler(config *claude.ConfigStore) *ClaudeHandler {
	return &ClaudeHandler{config: config}
}
```

改为：
```go
type ClaudeHandler struct {
	config  *claude.ConfigStore
	manager *claude.Manager
}

func NewClaudeHandler(config *claude.ConfigStore, manager *claude.Manager) *ClaudeHandler {
	return &ClaudeHandler{config: config, manager: manager}
}
```

- [ ] **Step 3: 追加 WS handler**

在 claude_handler.go 末尾追加。imports 区确保包含：
```go
import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/alwaysking/akmdlibrary/internal/service/claude"
)
```

方法体：
```go
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
```

- [ ] **Step 4: 修改 main.go 装配**

在 Task 8 `claudeConfigStore` 之后追加（替换 Task 9 的 handler 装配）：
```go
claudeManager := claude.NewManager(claudeConfigStore, memberRepo, spaceRepo, authService, docsDir)
claudeHandler := handler.NewClaudeHandler(claudeConfigStore, claudeManager)
```

注册路由（与现有 public 路由同级——不挂 RequireAuth，因为 WS 用 query token）：
```go
// Public routes
r.Post("/api/auth/login", authHandler.Login)
r.Post("/api/auth/logout", authHandler.Logout)
r.Get("/api/site-settings", siteSettingHandler.Get)
// Claude WebSocket（独立鉴权——浏览器 WS 不能用 Authorization header）
r.Get("/api/spaces/{slug}/claude/ws", claudeHandler.ChatWS)
```

注意：admin Claude config 接口（Task 9 的 GetConfig/UpdateConfig）仍留在 `RequireAdmin` group 内不变。

- [ ] **Step 5: 构建验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 6: 提交**

```bash
git add backend/internal/handler/claude_handler.go backend/cmd/server/main.go
git commit -m "feat(claude): wire up WebSocket chat handler"
```

---

## Phase 6: 前端 Claude 聊天 UI

### Task 19: useClaudeChat hook

**Files:**
- Create: `frontend/src/hooks/useClaudeChat.ts`

- [ ] **Step 1: 创建 hook**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

export type ChatStatus = 'idle' | 'answering' | 'error';

export interface ChatMessage {
  id: string; // 用于 react key
  role: 'user' | 'assistant' | 'system';
  content: string;
  variant?: 'denied' | 'error'; // system 消息的子类型
}

interface UseClaudeChatOptions {
  spaceSlug: string | null;
  enabled: boolean; // space 是否启用 claude
}

interface UseClaudeChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  isConnected: boolean;
  send: (text: string) => void;
  reset: () => void;
}

let msgIdCounter = 0;
function nextId() {
  msgIdCounter += 1;
  return `m${Date.now()}_${msgIdCounter}`;
}

export function useClaudeChat({ spaceSlug, enabled }: UseClaudeChatOptions): UseClaudeChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // 切换 space 或 enabled 变化 → 重置
  useEffect(() => {
    if (!enabled || !spaceSlug) {
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    setMessages([]);
    setStatus('idle');

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/spaces/${encodeURIComponent(spaceSlug)}/claude/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'status':
          setStatus(msg.status === 'answering' ? 'answering' : 'idle');
          break;
        case 'assistant_message':
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: msg.content }]);
          setStatus('idle');
          break;
        case 'permission_denied':
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'system',
            variant: 'denied' as const,
            content: `已拒绝 ${msg.tool}${msg.path ? ' ' + msg.path : ''} — ${msg.reason}`,
          }]);
          break;
        case 'error':
          setMessages(prev => [...prev, {
            id: nextId(),
            role: 'system',
            variant: 'error' as const,
            content: msg.message,
          }]);
          setStatus('error');
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [spaceSlug, enabled]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (status === 'answering') return;
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: trimmed }]);
    wsRef.current.send(JSON.stringify({ type: 'user_message', content: trimmed }));
  }, [status]);

  const reset = useCallback(() => {
    setMessages([]);
    setStatus('idle');
  }, []);

  return { messages, status, isConnected, send, reset };
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/useClaudeChat.ts
git commit -m "feat(hooks): add useClaudeChat for WS connection"
```

---

### Task 20: ClaudeChat 组件群

**Files:**
- Create: `frontend/src/components/ClaudeChat/MessageList.tsx`
- Create: `frontend/src/components/ClaudeChat/MessageInput.tsx`
- Create: `frontend/src/components/ClaudeChat/ChatPanel.tsx`
- Create: `frontend/src/components/ClaudeChat/FloatingButton.tsx`
- Create: `frontend/src/components/ClaudeChat/index.tsx`

- [ ] **Step 1: MessageList.tsx**

```tsx
import { ChatMessage } from '../../hooks/useClaudeChat';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-notion-textSecondary">
        向 Claude 提问关于这个空间的问题
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      {messages.map(m => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          );
        }
        if (m.role === 'assistant') {
          return (
            <div key={m.id} className="flex">
              <div className="max-w-[90%] px-3 py-1.5 bg-white border border-notion-border rounded-lg text-sm text-notion-text whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          );
        }
        // system
        const cls = m.variant === 'error'
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-amber-50 text-amber-800 border-amber-200';
        return (
          <div key={m.id} className={`text-xs px-2 py-1 border rounded ${cls}`}>
            {m.content}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: MessageInput.tsx**

```tsx
import { useState, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-notion-border p-2 flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={disabled ? 'Claude 正在回答...' : '输入消息，Enter 发送'}
        className="flex-1 px-2 py-1.5 border border-notion-border rounded text-sm resize-none max-h-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
        disabled={disabled}
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="p-2 bg-notion-text text-white rounded hover:bg-notion-text/90 disabled:opacity-30"
        title="发送"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: ChatPanel.tsx（可拖拽）**

```tsx
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useClaudeChat } from '../../hooks/useClaudeChat';

interface Props {
  spaceSlug: string;
  onClose: () => void;
}

export function ChatPanel({ spaceSlug, onClose }: Props) {
  const { messages, status, send } = useClaudeChat({ spaceSlug, enabled: true });
  const [pos, setPos] = useState({ x: window.innerWidth - 400, y: window.innerHeight - 560 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // 拖拽
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 380, e.clientX - dragRef.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragRef.current.dy)),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };

  return (
    <div
      className="fixed z-50 w-[380px] h-[520px] bg-notion-bg border border-notion-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onMouseDown={startDrag}
        className="px-3 py-2 bg-notion-text text-white flex items-center justify-between cursor-move select-none"
      >
        <span className="text-sm font-medium">Claude</span>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded" title="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>
      {status === 'answering' && (
        <div className="px-3 py-1 text-xs text-notion-textSecondary bg-notion-hover border-b border-notion-border">
          Claude 正在思考...
        </div>
      )}
      <MessageList messages={messages} />
      <MessageInput onSend={send} disabled={status === 'answering'} />
    </div>
  );
}
```

- [ ] **Step 4: FloatingButton.tsx**

```tsx
import { Bot } from 'lucide-react';

export function FloatingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-notion-text text-white shadow-lg hover:bg-notion-text/90 flex items-center justify-center"
      title="Claude 助手"
    >
      <Bot className="w-6 h-6" />
    </button>
  );
}
```

- [ ] **Step 5: index.tsx（组合入口）**

```tsx
import { useState } from 'react';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { FloatingButton } from './FloatingButton';
import { ChatPanel } from './ChatPanel';

export function ClaudeChat() {
  const [open, setOpen] = useState(false);
  const { user, isAuthenticated } = useAuthStore();
  const currentSpace = useSpaceStore(s => s.currentSpace);

  // 未登录不显示
  if (!isAuthenticated || !user) return null;

  // 当前 space 未启用 claude 不显示
  if (!currentSpace || !currentSpace.feature_flags?.claude) return null;

  return (
    <>
      {!open && <FloatingButton onClick={() => setOpen(true)} />}
      {open && <ChatPanel spaceSlug={currentSpace.slug} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 6: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/ClaudeChat/
git commit -m "feat(claude-ui): add floating button + draggable chat panel"
```

---

### Task 21: AppLayout 全局挂载 ClaudeChat

**Files:**
- Modify: `frontend/src/components/Layout/AppLayout.tsx`

- [ ] **Step 1: 读取现有 AppLayout**

Run: `cat frontend/src/components/Layout/AppLayout.tsx`

理解其结构（Outlet 等）。

- [ ] **Step 2: 在 AppLayout 顶层挂载 ClaudeChat**

在 AppLayout 返回的 JSX 中，与 `<Outlet />` 同级添加：

```tsx
import { ClaudeChat } from '../ClaudeChat';

// 在主 return 中：
return (
  <div className="...">
    {/* existing layout */}
    <Outlet />
    <ClaudeChat />
  </div>
);
```

具体位置：参考 AppLayout 现有结构，把 `<ClaudeChat />` 放在最外层 div 内、所有内容之后即可。这样它在所有页面都可见（登录页除外——但 AppLayout 只在 ProtectedRoute 内被渲染，所以登录页天然不会渲染 ClaudeChat）。

- [ ] **Step 3: 切换 space 自动关闭面板**

由于 `ClaudeChat` 内部 `useState` 控制开关，切换 space 不会自动关闭。但 `useClaudeChat` 内部监听 `spaceSlug` 变化会断开重连 + 清空消息。

如果希望切换 space 时也关闭面板，把 `open` 状态依赖 `currentSpace?.slug`：

```tsx
import { useEffect, useState } from 'react';
// ...
const [open, setOpen] = useState(false);
useEffect(() => {
  setOpen(false); // 切换 space 关闭面板
}, [currentSpace?.slug]);
```

- [ ] **Step 4: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/Layout/AppLayout.tsx
git commit -m "feat(layout): mount ClaudeChat globally"
```

---

### Task 22: 端到端联调

**Files:** 无修改，仅验证

- [ ] **Step 1: 启动后端 + 前端**

后端：`cd backend && go run ./cmd/server`
前端：`cd frontend && npm run dev`

- [ ] **Step 2: 配置 Claude**

以 admin 登录 → 设置 → Claude → 填入 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` → 保存。

- [ ] **Step 3: 在某 space 启用 Claude**

设置 → 空间管理 → 展开某 space → 勾选「Claude 助手」。

- [ ] **Step 4: 验证悬浮按钮**

进入该 space 主页 → 右下角应出现圆形 Bot 按钮。
进入另一个未启用 Claude 的 space → 按钮应消失。

- [ ] **Step 5: 验证对话**

点击按钮 → 弹出面板 → 输入 "你好" → 应收到 Claude 回复（如果不是增量而是完整回复，正确）。

- [ ] **Step 6: 验证权限拒绝**

输入 "请读取 /etc/passwd" → Claude 尝试调用 Read → 应看到红色系统消息「已拒绝 Read /etc/passwd — 路径不在当前空间范围内」，Claude 应自行调整策略（不会再尝试）。

- [ ] **Step 7: 验证 viewer 写权限**

把某用户加为某 space 的 `viewer` → 该用户登录 → 在 Claude 里要求 "修改 xxx.md" → 应看到「已拒绝 Write — 当前用户在该空间没有写权限」。

- [ ] **Step 8: 验证 space 切换重置**

打开面板 → 切换到另一个 space → 面板应关闭（或重新打开时为新会话，消息列表清空）。

- [ ] **Step 9: 验证刷新即新会话**

打开面板 → 发几条消息 → 刷新页面 → 重新打开面板 → 消息列表应为空。

- [ ] **Step 10: 提交联调记录**

如果发现 bug，按"正确处理问题的方式"先定位根因再修，不在本任务里塞 patch。修完后单独提交：

```bash
git add ...
git commit -m "fix(claude): <具体描述>"
```

---

## Self-Review Checklist

实现完成后逐项过一遍：

- [ ] Docker：未设置 USER_* 环境变量时容器正常启动（不切换用户）
- [ ] Docker：设置 USER_* 时正确创建用户、symlink、切换、运行
- [ ] Space feature_flags.claude 默认 false，前端隐藏按钮，后端拒绝 WS
- [ ] 管理员能编辑 settings.json / system prompt / 工具开关并持久化
- [ ] claude session 启动时读取 data/claude 内容（env / system prompt / tool config）
- [ ] 路径校验通过：`/app/docs/demo/note.md` 在 `/app/docs/demo` 内
- [ ] 路径校验拒绝：`../`、绝对外部路径、前缀相似（demoX vs demo）
- [ ] viewer 用户写操作被拒，editor/admin 允许
- [ ] Bash 默认拒，开关打开后允许
- [ ] 站点管理员不是 space 成员时连不上 WS
- [ ] WS 断开 claude 进程被 kill，不泄漏
- [ ] 前端切换 space 重置消息列表与 WS 连接
- [ ] 前端刷新页面 = 新会话
