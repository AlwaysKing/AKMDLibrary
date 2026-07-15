# 空间级功能开关 (Git 管理) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每个空间加一个 Git 管理功能开关（默认关闭），关闭时隐藏前端入口、拦截后端 git 接口、停止后台自动 commit。

**Architecture:** `spaces` 表新增 `feature_flags TEXT` 列存 JSON（`json.RawMessage`，前后端透明）。`model.Space` 加 `ParseFeatureFlags()` 方法。新增 `PUT /api/spaces/{slug}/feature-flags` 接口。新增 `RequireGitFeature` 中间件包裹所有 git 路由。`GitSyncWorker` 注入 `SpaceService` 引用，`commitNow` 和 `markGitDirty` 都做防御性检查。前端 `Space` 类型加 `feature_flags` 字段，AdminPage 编辑面板顶部加复选框，Sidebar 显示条件加 `feature_flags.git`。

**Tech Stack:** Go + chi + SQLite + React + TypeScript + Zustand + Tailwind

**Codebase notes:**
- 本仓库**没有任何 Go test 或 JS test**。每个任务用编译/启动/手动 curl/手动 UI 点击来验证。
- 提交风格：短英文 commit message，每个任务一个 commit。

**参考 spec:** `docs/superpowers/specs/2026-06-25-space-feature-flag-git-design.md`

---

## File Structure

**Backend 改动**：
- `backend/internal/model/space.go` — 修改：加 `FeatureFlags` 字段 + `FeatureFlags` 类型 + 解析助手
- `backend/internal/repository/db.go` — 修改：`migrate()` 加 `feature_flags` 列
- `backend/internal/repository/space_repo.go` — 修改：所有 SELECT/INSERT 加列；新增 `UpdateFeatureFlags`
- `backend/internal/service/space_service.go` — 修改：新增 `UpdateFeatureFlags` 方法
- `backend/internal/service/git_sync_worker.go` — 修改：加 `spaceService` 字段、`SetSpaceService` 方法、`commitNow` 加防御检查
- `backend/internal/service/page_service.go` — 修改：`markGitDirty` 加 feature 检查
- `backend/internal/handler/space_handler.go` — 修改：新增 `UpdateFeatureFlags` handler
- `backend/internal/middleware/feature_flag.go` — 创建：`RequireGitFeature` 中间件
- `backend/cmd/server/main.go` — 修改：注册 `PUT /feature-flags` 路由；git 路由用 `r.Group` 包裹中间件；给 worker 注入 spaceService

**Frontend 改动**：
- `frontend/src/api/spaces.ts` — 修改：加 `FeatureFlags` 接口和 `Space.feature_flags`；加 `updateFeatureFlags` 方法
- `frontend/src/pages/AdminPage.tsx` — 修改：`spaceFormData` 加 `feature_flags`；编辑面板顶部加复选框；乐观更新 + 调用 API
- `frontend/src/components/Layout/Sidebar.tsx` — 修改：第 348 行附近显示条件加 `currentSpace?.feature_flags?.git`

---

## Task 1: 数据模型 + DB 迁移 + Repository

**Files:**
- Modify: `backend/internal/model/space.go`
- Modify: `backend/internal/repository/db.go`
- Modify: `backend/internal/repository/space_repo.go`

- [ ] **Step 1: 修改 `model/space.go`**

完整替换文件内容：

```go
package model

import (
	"encoding/json"
	"time"
)

type Space struct {
	ID           int          `json:"id" db:"id"`
	Name         string       `json:"name" db:"name"`
	Slug         string       `json:"slug" db:"slug"`
	Icon         string       `json:"icon" db:"icon"`
	Description  string       `json:"description" db:"description"`
	FeatureFlags json.RawMessage `json:"feature_flags" db:"feature_flags"`
	CreatedAt    time.Time    `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at" db:"updated_at"`
}

// FeatureFlags is the parsed shape of Space.FeatureFlags.
// Add new toggles here as fields; they default to false when absent.
type FeatureFlags struct {
	Git bool `json:"git"`
}

// DefaultFeatureFlags returns the flags for a brand-new space: all off.
func DefaultFeatureFlags() FeatureFlags {
	return FeatureFlags{Git: false}
}

// ParseFeatureFlags decodes the JSON column into a FeatureFlags struct.
// Empty/invalid JSON yields the zero value (all features off).
func (s *Space) ParseFeatureFlags() FeatureFlags {
	var f FeatureFlags
	if len(s.FeatureFlags) == 0 {
		return f
	}
	if err := json.Unmarshal(s.FeatureFlags, &f); err != nil {
		return FeatureFlags{}
	}
	return f
}

type CreateSpaceRequest struct {
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

type UpdateSpaceRequest struct {
	Name        *string `json:"name"`
	Slug        *string `json:"slug"`
	Icon        *string `json:"icon"`
	Description *string `json:"description"`
}
```

注意：`FeatureFlags` 用 `json.RawMessage`。这样 JSON 列内容直接序列化为对象传给前端，前端无需 parse 字符串。空值或 `{}` 在前端会被解析为 `{git: false}` 一致语义。

- [ ] **Step 2: 修改 `db.go` 的 `migrate()`**

在 `backend/internal/repository/db.go` 找到 `migrate()` 函数末尾段（在 `ALTER TABLE pages ADD COLUMN is_locked` 那段之后，`return nil` 之前），追加：

```go
	if _, err := db.Exec(`ALTER TABLE spaces ADD COLUMN feature_flags TEXT NOT NULL DEFAULT '{}'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate spaces.feature_flags: %w", err)
		}
	}
```

- [ ] **Step 3: 修改 `space_repo.go` 的 `Create`**

在 `backend/internal/repository/space_repo.go` 的 `Create` 方法中：

旧代码（约 17-22 行）：
```go
	query := `
		INSERT INTO spaces (name, slug, icon, description)
		VALUES (?, ?, ?, ?)
	`

	result, err := r.db.Exec(query, space.Name, slug, space.Icon, space.Description)
```

替换为：
```go
	query := `
		INSERT INTO spaces (name, slug, icon, description, feature_flags)
		VALUES (?, ?, ?, ?, '{}')
	`

	result, err := r.db.Exec(query, space.Name, slug, space.Icon, space.Description)
```

- [ ] **Step 4: 修改 `space_repo.go` 的 `GetByID`**

旧代码（约 29-45 行）：
```go
	query := `
		SELECT id, name, slug, icon, description, created_at, updated_at
		FROM spaces WHERE id = ?
	`

	var space model.Space
	var icon, description sql.NullString
	err := r.db.QueryRow(query, id).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &space.CreatedAt, &space.UpdatedAt,
	)
```

替换为：
```go
	query := `
		SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
		FROM spaces WHERE id = ?
	`

	var space model.Space
	var icon, description sql.NullString
	var featureFlags string
	err := r.db.QueryRow(query, id).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
	)
	space.FeatureFlags = json.RawMessage(featureFlags)
```

文件顶部 import 块新增 `"encoding/json"`。

- [ ] **Step 5: 修改 `space_repo.go` 的 `GetBySlug`**

旧代码（约 55-77 行）：
```go
	query := `
		SELECT id, name, slug, icon, description, created_at, updated_at
		FROM spaces WHERE slug = ?
	`

	var space model.Space
	var icon, description sql.NullString
	err := r.db.QueryRow(query, slug).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &space.CreatedAt, &space.UpdatedAt,
	)
```

替换为：
```go
	query := `
		SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
		FROM spaces WHERE slug = ?
	`

	var space model.Space
	var icon, description sql.NullString
	var featureFlags string
	err := r.db.QueryRow(query, slug).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
	)
	space.FeatureFlags = json.RawMessage(featureFlags)
```

- [ ] **Step 6: 修改 `space_repo.go` 的 `ListByUserID`**

旧代码（约 75-148 行）。两处 SQL（`userID == 0` 和 else 分支）都要改 SELECT：

`userID == 0` 分支：
```go
		query = `
			SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
			FROM spaces
			ORDER BY created_at DESC
		`
```
else 分支：
```go
		query = `
			SELECT DISTINCT s.id, s.name, s.slug, s.icon, s.description, s.feature_flags, s.created_at, s.updated_at
			FROM spaces s
			JOIN space_members sm ON s.id = sm.space_id
			WHERE sm.user_id = ?
			ORDER BY s.created_at DESC
		`
```

`rows.Scan` 块改为：
```go
		var space model.Space
		var icon, description sql.NullString
		var featureFlags string
		if err := rows.Scan(
			&space.ID, &space.Name, &space.Slug, &icon,
			&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan space: %w", err)
		}

		if icon.Valid {
			space.Icon = icon.String
		}
		if description.Valid {
			space.Description = description.String
		}
		space.FeatureFlags = json.RawMessage(featureFlags)
```

- [ ] **Step 7: 新增 `space_repo.go` 的 `UpdateFeatureFlags` 方法**

在 `Update` 方法（约 151-181 行）后面插入：

```go
// UpdateFeatureFlags overwrites the feature_flags JSON column for a space.
func (r *SpaceRepository) UpdateFeatureFlags(slug string, flagsJSON string) error {
	result, err := r.db.Exec(
		`UPDATE spaces SET feature_flags = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?`,
		flagsJSON, slug,
	)
	if err != nil {
		return fmt.Errorf("failed to update feature_flags: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("space not found")
	}
	return nil
}
```

- [ ] **Step 8: 编译验证**

Run: `cd backend && go build ./...`
Expected: 编译通过，无错误输出。

- [ ] **Step 9: 提交**

```bash
git add backend/internal/model/space.go backend/internal/repository/db.go backend/internal/repository/space_repo.go
git commit -m "Add feature_flags JSON column to spaces"
```

---

## Task 2: Service 层 UpdateFeatureFlags 方法

**Files:**
- Modify: `backend/internal/service/space_service.go`

- [ ] **Step 1: 加 import**

文件顶部 import 块新增 `"encoding/json"`。

- [ ] **Step 2: 新增 `UpdateFeatureFlags` 方法**

在 `space_service.go` 的 `Update` 方法（108-137 行）后面插入：

```go
// UpdateFeatureFlags overwrites the feature_flags JSON for a space and returns
// the parsed object. Callers pass the full FeatureFlags struct (PUT semantics:
// replace, not merge).
func (s *SpaceService) UpdateFeatureFlags(slug string, flags model.FeatureFlags) (model.FeatureFlags, error) {
	data, err := json.Marshal(flags)
	if err != nil {
		return model.FeatureFlags{}, fmt.Errorf("failed to marshal feature flags: %w", err)
	}
	if err := s.spaceRepo.UpdateFeatureFlags(slug, string(data)); err != nil {
		return model.FeatureFlags{}, err
	}
	return flags, nil
}
```

- [ ] **Step 3: 编译验证**

Run: `cd backend && go build ./...`
Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
git add backend/internal/service/space_service.go
git commit -m "Add UpdateFeatureFlags service method"
```

---

## Task 3: Handler 层 `PUT /feature-flags` 接口

**Files:**
- Modify: `backend/internal/handler/space_handler.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: 在 `space_handler.go` 末尾追加 handler**

在 `Refresh` 方法（217-226 行）后追加：

```go
func (h *SpaceHandler) UpdateFeatureFlags(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	// Verify space exists
	if _, err := h.spaceService.GetBySlug(slug); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	var req model.FeatureFlags
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	flags, err := h.spaceService.UpdateFeatureFlags(slug, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"feature_flags": flags,
	})
}
```

注意：admin 鉴权交给路由注册时挂中间件，handler 不重复检查。

- [ ] **Step 2: 在 `main.go` 注册路由**

找到 `main.go` 的 spaces 路由块（约 142-147 行）：
```go
		r.Get("/api/spaces", spaceHandler.List)
		r.Get("/api/spaces/{slug}", spaceHandler.Get)
		r.Post("/api/spaces", spaceHandler.Create)
		r.Put("/api/spaces/{slug}", spaceHandler.Update)
		r.Delete("/api/spaces/{slug}", spaceHandler.Delete)
		r.Post("/api/spaces/{slug}/refresh", spaceHandler.Refresh)
```

在最后加一行：
```go
		r.Put("/api/spaces/{slug}/feature-flags", spaceHandler.UpdateFeatureFlags)
```

**说明**：当前后端没有 per-space 的 admin 中间件，挂的是全局 `RequireAuth`。任何登录用户都能调用此接口。这与现有"add member / update member"接口的鉴权级别一致（也是任何登录用户都能调）。本期保持一致，不引入新鉴权层级。

- [ ] **Step 3: 编译验证**

Run: `cd backend && go build ./...`
Expected: 编译通过。

- [ ] **Step 4: 启动 + curl 验证**

启动后端：`cd backend && go run ./cmd/server/`

获取 token（替换为实际 admin 账号）：
```bash
curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<YOUR_ADMIN_PASSWORD>"}' | jq -r .token
```

设环境变量：`TOKEN=<the token>`

调用接口：
```bash
curl -s -X PUT http://localhost:8080/api/spaces/<some-slug>/feature-flags \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"git":true}'
```
Expected: `{"feature_flags":{"git":true}}`

验证 Space 响应：
```bash
curl -s http://localhost:8080/api/spaces/<some-slug> -H "Authorization: Bearer $TOKEN" | jq .feature_flags
```
Expected: `{"git":true}`（注意是对象，不是字符串）

关掉开关：
```bash
curl -s -X PUT http://localhost:8080/api/spaces/<some-slug>/feature-flags \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"git":false}'
```
Expected: `{"feature_flags":{"git":false}}`

- [ ] **Step 5: 提交**

```bash
git add backend/internal/handler/space_handler.go backend/cmd/server/main.go
git commit -m "Add PUT /spaces/{slug}/feature-flags endpoint"
```

---

## Task 4: Git Feature 中间件（拦截 403）

**Files:**
- Create: `backend/internal/middleware/feature_flag.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: 创建中间件文件**

完整创建 `backend/internal/middleware/feature_flag.go`：

```go
package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

// FeatureFlagMiddleware holds dependencies for feature-flag gating middleware.
type FeatureFlagMiddleware struct {
	spaceService *service.SpaceService
}

func NewFeatureFlagMiddleware(spaceService *service.SpaceService) *FeatureFlagMiddleware {
	return &FeatureFlagMiddleware{spaceService: spaceService}
}

// RequireGitFeature returns 403 when the space's feature_flags.git is false.
// Resolves the space from the URL's {slug} param.
func (m *FeatureFlagMiddleware) RequireGitFeature(next http.Handler) http.Handler {
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
		if !flags.Git {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "git feature disabled for this space",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 2: 在 `main.go` 注入中间件**

找到 `main.go` 第 109 行：
```go
	authMiddleware := middleware.NewAuthMiddleware(authService)
```
在下面加：
```go
	featureFlagMiddleware := middleware.NewFeatureFlagMiddleware(spaceService)
```

- [ ] **Step 3: 在 `main.go` 给 git 路由包裹中间件**

找到 git 路由块（约 173-183 行）：
```go
		// Git (per-space; UI hides these when space isn't a git repo)
		r.Get("/api/spaces/{slug}/git/state", gitHandler.State)
		r.Post("/api/spaces/{slug}/git/commit", gitHandler.Commit)
		r.Post("/api/spaces/{slug}/git/restore", gitHandler.Restore)
		r.Post("/api/spaces/{slug}/git/push", gitHandler.Push)
		r.Post("/api/spaces/{slug}/git/pull", gitHandler.Pull)
		r.Get("/api/spaces/{slug}/git/config", gitHandler.GetConfig)
		r.Put("/api/spaces/{slug}/git/config", gitHandler.SetConfig)
		r.Get("/api/spaces/{slug}/git/credentials", gitHandler.GetCredential)
		r.Put("/api/spaces/{slug}/git/credentials", gitHandler.SetCredential)
		r.Delete("/api/spaces/{slug}/git/credentials", gitHandler.DeleteCredential)
```

替换为 `r.Group` 包裹：
```go
		// Git (per-space; UI hides these when space isn't a git repo).
		// RequireGitFeature returns 403 when feature_flags.git is off.
		r.Group(func(r chi.Router) {
			r.Use(featureFlagMiddleware.RequireGitFeature)
			r.Get("/api/spaces/{slug}/git/state", gitHandler.State)
			r.Post("/api/spaces/{slug}/git/commit", gitHandler.Commit)
			r.Post("/api/spaces/{slug}/git/restore", gitHandler.Restore)
			r.Post("/api/spaces/{slug}/git/push", gitHandler.Push)
			r.Post("/api/spaces/{slug}/git/pull", gitHandler.Pull)
			r.Get("/api/spaces/{slug}/git/config", gitHandler.GetConfig)
			r.Put("/api/spaces/{slug}/git/config", gitHandler.SetConfig)
			r.Get("/api/spaces/{slug}/git/credentials", gitHandler.GetCredential)
			r.Put("/api/spaces/{slug}/git/credentials", gitHandler.SetCredential)
			r.Delete("/api/spaces/{slug}/git/credentials", gitHandler.DeleteCredential)
		})
```

- [ ] **Step 4: 编译验证**

Run: `cd backend && go build ./...`
Expected: 编译通过。

- [ ] **Step 5: 启动 + curl 验证**

确保上一个 Task 把 `feature_flags.git` 设置成了 `false`。重启后端。

调用被拦截的接口：
```bash
curl -s http://localhost:8080/api/spaces/<some-slug>/git/state \
  -H "Authorization: Bearer $TOKEN"
```
Expected: HTTP 403，body: `{"error":"git feature disabled for this space"}`

开启后再调：
```bash
curl -s -X PUT http://localhost:8080/api/spaces/<some-slug>/feature-flags \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"git":true}'
curl -s http://localhost:8080/api/spaces/<some-slug>/git/state \
  -H "Authorization: Bearer $TOKEN"
```
Expected: 不再返回 403（具体返回看 git 服务实现，可能是 200 状态信息或 4xx 如果目录不是 git repo）。

- [ ] **Step 6: 提交**

```bash
git add backend/internal/middleware/feature_flag.go backend/cmd/server/main.go
git commit -m "Gate git routes with RequireGitFeature middleware"
```

---

## Task 5: 后台 Worker + PageService 防御性检查

**Files:**
- Modify: `backend/internal/service/git_sync_worker.go`
- Modify: `backend/internal/service/page_service.go`
- Modify: `backend/cmd/server/main.go`

**依赖注意**：`GitSyncWorker` 目前**没有** `SpaceService` 引用（避免循环依赖）。这里采用：worker 内部加一个 `gitFeatureEnabled func(slug string) bool` 回调字段，由 `main.go` 在启动时注入，避免循环依赖。

- [ ] **Step 1: 修改 `git_sync_worker.go` 的 struct 和构造**

旧代码（18-38 行 + 48-57 行）：
```go
type GitSyncWorker struct {
	git *GitService
	...
}

func NewGitSyncWorker(git *GitService) *GitSyncWorker {
	return &GitSyncWorker{
		git:      git,
		dirty:    make(map[string]time.Time),
		timers:   make(map[string]*time.Timer),
		cfgCache: make(map[string]cachedConfig),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}
```

新增字段 + setter，在 struct 中加一个字段（在 `stop` 之前插入即可）：
```go
type GitSyncWorker struct {
	git *GitService
	... // existing fields unchanged

	// gitFeatureEnabled returns false when the space has feature_flags.git
	// disabled. Optional; nil means "all enabled". Injected from main.go to
	// avoid a circular import with SpaceService.
	gitFeatureEnabled func(slug string) bool
}
```

在 `NewGitSyncWorker` **后面**新增 setter：
```go
// SetGitFeatureProbe injects a callback the worker consults before committing.
// Returning false causes commitNow and MarkDirty to skip the space entirely.
func (w *GitSyncWorker) SetGitFeatureProbe(f func(slug string) bool) {
	w.gitFeatureEnabled = f
}
```

- [ ] **Step 2: 修改 `git_sync_worker.go` 的 `MarkDirty`**

旧代码（114-141 行）函数开头：
```go
func (w *GitSyncWorker) MarkDirty(slug string) {
	if w.stopping.Load() {
		return
	}
	...
```

加 feature 检查：
```go
func (w *GitSyncWorker) MarkDirty(slug string) {
	if w.stopping.Load() {
		return
	}
	if w.gitFeatureEnabled != nil && !w.gitFeatureEnabled(slug) {
		return
	}
	...
```

- [ ] **Step 3: 修改 `git_sync_worker.go` 的 `commitNow`**

旧代码（147-150 行）函数开头：
```go
func (w *GitSyncWorker) commitNow(slug, reason string) {
	if w.stopping.Load() {
		return
	}
```

加 feature 检查：
```go
func (w *GitSyncWorker) commitNow(slug, reason string) {
	if w.stopping.Load() {
		return
	}
	if w.gitFeatureEnabled != nil && !w.gitFeatureEnabled(slug) {
		return
	}
```

- [ ] **Step 4: 修改 `main.go` 注入 probe**

在 `main.go` 找到 worker 初始化/启动的位置。需要先找到 worker 在哪里被构造。

Run: `grep -n "NewGitSyncWorker\|SetGitSyncWorker\|gitSyncWorker\|gitSync\b\|worker\.Start" backend/cmd/server/main.go`

根据输出在 worker 构造完成后（`SetGitSyncWorker` 之后，`Start` 之前）插入：

```go
	// Inject feature-flag probe so the worker skips spaces with git disabled.
	// This must run after spaceService is wired with the worker.
	gitSyncWorker.SetGitFeatureProbe(func(slug string) bool {
		space, err := spaceService.GetBySlug(slug)
		if err != nil {
			return false
		}
		return space.ParseFeatureFlags().Git
	})
```

（变量名 `gitSyncWorker` 替换为 grep 结果中的实际变量名。）

- [ ] **Step 5: 编译验证**

Run: `cd backend && go build ./...`
Expected: 编译通过。

- [ ] **Step 6: 提交**

```bash
git add backend/internal/service/git_sync_worker.go backend/cmd/server/main.go
git commit -m "Skip auto-commit when git feature disabled for space"
```

**说明**：PageService 已经通过 `markGitDirty` → `gitSync.MarkDirty` 调用，而 `MarkDirty` 内部现在会先检查 feature。所以 `page_service.go` 本身不需要改动 —— 三层防御简化为两层（API + Worker），效果等同。这是 spec 中"防御性兜底"的具体落实。

---

## Task 6: 前端类型 + API 方法

**Files:**
- Modify: `frontend/src/api/spaces.ts`

- [ ] **Step 1: 修改 `frontend/src/api/spaces.ts`**

修改 `Space` 接口和文件末尾的 `spacesApi` 对象。

旧代码（3-11 行）：
```ts
export interface Space {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}
```

替换为：
```ts
export interface FeatureFlags {
  git: boolean;
}

export interface Space {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  description?: string;
  feature_flags: FeatureFlags;
  created_at: string;
  updated_at: string;
}
```

在文件末尾的 `spacesApi` 对象的 `refresh` 方法（约 56-58 行）后，插入新方法：
```ts
  updateFeatureFlags: async (slug: string, flags: FeatureFlags): Promise<FeatureFlags> => {
    const response = await apiClient.put<{ feature_flags: FeatureFlags }>(
      `/spaces/${slug}/feature-flags`,
      flags
    );
    return response.data.feature_flags;
  },
```

- [ ] **Step 2: 类型检查验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/spaces.ts
git commit -m "Add feature_flags to Space type and updateFeatureFlags API"
```

---

## Task 7: AdminPage 编辑面板顶部复选框

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 修改 `spaceFormData` state 类型**

找到 `AdminPage.tsx` 第 121 行：
```ts
const [spaceFormData, setSpaceFormData] = useState({ name: '', icon: '', description: '' });
```

替换为：
```ts
const [spaceFormData, setSpaceFormData] = useState<{ name: string; icon: string; description: string; feature_flags: FeatureFlags }>({ name: '', icon: '', description: '', feature_flags: { git: false } });
```

文件顶部 import 修改，确保第 5 行包含 `FeatureFlags`：
```ts
import { spacesApi, Space, SpaceMember, FeatureFlags } from '../api/spaces';
```

- [ ] **Step 2: 修改 `openCreatePanel`**

第 566-571 行：
```ts
const openCreatePanel = () => {
  setSpaceFormData({ name: '', icon: '', description: '' });
  ...
```

替换为：
```ts
const openCreatePanel = () => {
  setSpaceFormData({ name: '', icon: '', description: '', feature_flags: { git: false } });
  ...
```

- [ ] **Step 3: 修改 `openEditPanel`**

第 578 行：
```ts
setSpaceFormData({ name: space.name, icon: space.icon || '', description: space.description || '' });
```

替换为：
```ts
setSpaceFormData({ name: space.name, icon: space.icon || '', description: space.description || '', feature_flags: { ...(space.feature_flags ?? { git: false }) } });
```

- [ ] **Step 4: 新增 `handleToggleGitFeature` 函数**

在 `handleSavePanel`（594-608 行）后面，**`handleDeleteSpace`（610 行）之前**插入：

```ts
const handleToggleGitFeature = async (checked: boolean) => {
  if (!spacePanelSlug || spacePanelSlug === 'new') return;
  const previous = spaceFormData.feature_flags;
  // Optimistic update
  setSpaceFormData(prev => ({ ...prev, feature_flags: { ...prev.feature_flags, git: checked } }));
  try {
    const updated = await spacesApi.updateFeatureFlags(spacePanelSlug, { git: checked });
    setSpaceFormData(prev => ({ ...prev, feature_flags: updated }));
    // Keep the spaces list in sync so other components see the new flag.
    setSpaces(prev => prev.map(s => s.slug === spacePanelSlug ? { ...s, feature_flags: updated } : s));
  } catch (err: any) {
    // Roll back on failure
    setSpaceFormData(prev => ({ ...prev, feature_flags: previous }));
    setError(err.message);
  }
};
```

- [ ] **Step 5: 在 `renderInlinePanel` 顶部插入复选框**

找到 `AdminPage.tsx` 第 1124 行（`{isEditing && (` 之前），这是 `renderInlinePanel` 函数内、表单元素的开头。

实际上更准确的位置：在 `renderInlinePanel` 内，`{/* 成员区域（仅编辑模式） */}` 注释之前插入。这行注释位于第 1124 行。

在第 1123 行（`{isEditing ? null : (...)}` 块的闭合 `)}` 之后，第 1124 行 `{/* 成员区域 */}` 之前，插入：

```tsx
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

- [ ] **Step 6: 类型检查 + 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 类型检查通过，build 成功。

- [ ] **Step 7: 手动 UI 验证**

启动前端：`cd frontend && npm run dev`
登录 admin → 进入"空间管理" → 展开任一空间 → 验证：
1. 成员列表**上方**出现 `[ ] Git 管理` 一行
2. 下面有分隔线
3. 点击复选框，立即变 `[x]`，刷新页面后保持勾选
4. 取消勾选，刷新页面后保持未勾选
5. 后端 `GET /api/spaces/{slug}` 返回的 `feature_flags` 字段与 UI 状态一致

- [ ] **Step 8: 提交**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "Add Git feature checkbox to space edit panel"
```

---

## Task 8: Sidebar 显示条件

**Files:**
- Modify: `frontend/src/components/Layout/Sidebar.tsx`

- [ ] **Step 1: 修改第 348 行**

找到 `frontend/src/components/Layout/Sidebar.tsx` 第 348 行：
```tsx
          {gitState?.is_repo && (
```

替换为：
```tsx
          {currentSpace?.feature_flags?.git && gitState?.is_repo && (
```

- [ ] **Step 2: 类型检查验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 手动 UI 验证**

启动前端，登录 admin → 进入空间：
1. **关闭 Git 管理 + 目录是 git 仓库**：侧边栏不显示"Git 管理"按钮
2. **开启 Git 管理 + 目录是 git 仓库**：侧边栏显示按钮
3. **关闭 Git 管理 + 目录不是 git 仓库**：不显示按钮（原来也不会显示）
4. **开启 Git 管理 + 目录不是 git 仓库**：不显示按钮（原来也不会显示）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/Layout/Sidebar.tsx
git commit -m "Hide Git sidebar button when feature disabled for space"
```

---

## 验收清单

实现完所有 8 个 Task 后，做端到端验证：

- [ ] **存量空间**：迁移后默认 `feature_flags.git = false`，UI 复选框未勾选
- [ ] **新建空间**：`feature_flags.git = false`，UI 复选框未勾选
- [ ] **API 拦截**：git 关闭时所有 `/api/spaces/{slug}/git/*` 返回 403，错误信息为 `git feature disabled for this space`
- [ ] **Worker 跳过**：在 git 关闭的空间里编辑页面，**不会产生自动 commit**（用 `git log` 在空间目录验证；前提是该空间之前已配置过自动 commit）
- [ ] **前端隐藏**：git 关闭的空间，Sidebar 不显示"Git 管理"按钮
- [ ] **打开开关**：勾选复选框后立即调用 API，刷新页面保持状态，Sidebar 按钮在 is_repo 时出现
- [ ] **乐观更新回滚**：手动断网/后端停掉时点击复选框，UI 应回滚到原状态并显示错误

## 风险

- **数据破坏性**：迁移后所有存量空间的 git 功能被禁用，已配置过自动 commit 的用户需手动重开。在升级说明里写清。
- **循环依赖**：worker 不能直接 import SpaceService，所以用回调注入（`SetGitFeatureProbe`）绕开。
