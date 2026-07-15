# 空间级功能开关：Git 管理

**日期**：2026-06-25
**作者**：AK
**状态**：待实现

## 背景

当前 Git 管理功能对每个空间是自动启用的：只要空间目录下存在 `.git`，侧边栏就会出现"Git 管理"按钮，对应的 `/api/spaces/{slug}/git/*` 接口和后台自动 commit worker 都会工作。无法针对单个空间关闭这一整套行为。

## 目标

- 在空间管理 → 展开空间 → 内联面板里，**成员区上方**增加一个 Git 管理复选框
- 关闭时：前端隐藏入口；后端 git 接口 403；后台自动 commit worker 完全跳过该空间
- 数据存储用 JSON 字段，方便未来扩展更多功能开关（当前只有 Git 一项）
- 默认关闭，存量空间和新建空间都需要管理员手动开启才有 Git 功能

## 非目标

- 不引入"把空间初始化成 git 仓库"的能力（后端目前也不存在此功能）
- 不做用户级或全局级的开关，只做空间级
- 不在本期实现其它功能开关（如禁用全文搜索等），只搭好可扩展结构

## 设计

### 数据模型

`backend/internal/model/space.go`：

```go
type Space struct {
    ID           int       `json:"id" db:"id"`
    Name         string    `json:"name" db:"name"`
    Slug         string    `json:"slug" db:"slug"`
    Icon         string    `json:"icon" db:"icon"`
    Description  string    `json:"description" db:"description"`
    FeatureFlags string    `json:"-" db:"feature_flags"` // 原始 JSON 字符串，handler 层做反序列化
    CreatedAt    time.Time `json:"created_at" db:"created_at"`
    UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// FeatureFlags 是 feature_flags 列反序列化后的对象。新增开关时在此加字段。
type FeatureFlags struct {
    Git bool `json:"git"`
}

// DefaultFeatureFlags 返回一个全新空间的默认开关集合：全部关闭。
func DefaultFeatureFlags() FeatureFlags {
    return FeatureFlags{Git: false}
}
```

**返回前端时**：handler/service 层将 `FeatureFlags`（结构体）序列化后放进响应对象的 `feature_flags` 字段；前端拿到的就是对象，类型干净。

**JSON tag 说明**：`Space.FeatureFlags` 用 `json:"-"` 避免直接把字符串泄漏出去；handler 显式构造响应对象时填入 `feature_flags`（见"接口契约"小节）。

### 数据库迁移

`backend/internal/repository/db.go` 的 `migrate()` 增量段追加：

```go
if _, err := db.Exec(`ALTER TABLE spaces ADD COLUMN feature_flags TEXT NOT NULL DEFAULT '{}'`); err != nil {
    if !strings.Contains(err.Error(), "duplicate column") {
        return fmt.Errorf("failed to migrate spaces.feature_flags: %w", err)
    }
}
```

- 默认 `'{}'`（空 JSON 对象）。解析时 `null`/`{}`/字段缺失都视为各开关的零值（`git=false`），保持一致。
- 不做 `UPDATE spaces SET feature_flags='{"git":false}'` 的回填 —— `'{}'` 在语义上已经等于"全部关闭"。

### Repository 层

`backend/internal/repository/space_repo.go`：

1. **所有 SELECT**（`GetByID`、`GetBySlug`、`ListByUserID`、`ListAll` 等）增加 `feature_flags` 列
2. **`Create`** 插入时显式写 `'{}'`（虽然 DB 有 DEFAULT，但显式更安全，避免老数据无默认值的边界）
3. **新增方法**：

```go
func (r *SpaceRepository) UpdateFeatureFlags(slug string, flagsJSON string) error
```

   只更新 `feature_flags` 列；调用方负责把 `FeatureFlags` 结构体序列化成 JSON 字符串再传入。

### Service 层

`backend/internal/service/space_service.go`：

- 新增 `UpdateFeatureFlags(slug string, flags FeatureFlags) (*FeatureFlags, error)`：负责序列化、调用 repo、返回最新值
- 在返回 `Space` 给 handler 的入口处，把 `space.FeatureFlags`（string）反序列化为 `FeatureFlags`，方便 handler 拼响应

### 接口契约

#### 新增：`PUT /api/spaces/{slug}/feature-flags`

- 鉴权：仅空间管理员（admin 角色）或站点管理员
- 请求体：`{"git": true}`
- 响应：`{"feature_flags": {"git": true}}`
- 行为：整体覆盖 `feature_flags` JSON（前端发完整对象）；序列化失败返回 400

#### 响应中的 Space 对象（list/get/create/update）

```jsonc
{
  "id": 1, "name": "...", "slug": "...", "icon": "...", "description": "...",
  "feature_flags": { "git": false },   // 对象，非字符串
  "created_at": "...", "updated_at": "..."
}
```

#### Git 接口拦截（关闭时 403）

所有 `/api/spaces/{slug}/git/*` 路由通过一个公共中间件（或 handler 内联检查）：

- 解析当前 space 的 `feature_flags`，若 `git == false`，直接返回 `403 Forbidden`，body：`{"error":"git feature disabled for this space"}`
- 受影响路由：`state`、`commit`、`restore`、`push`、`pull`、`config`(GET/PUT)、`credentials`(GET/PUT)
- 实现优先用 **router 中间件**（`r.Group(...)` 或在 `main.go` 注册路由时统一挂），避免每个 handler 方法重复

### 后台自动 commit worker

三道防线，逐层防御：

1. **API 层**：`/config` 拦截意味着前端无法再写入 `akmdlibrary.autocommit.*`；但本空间此前已经配置过自动 commit 的，仍要禁用
2. **`backend/internal/service/page_service.go` 的 `markGitDirty`**：通知 worker 前先读 `feature_flags.git`，false 时直接 return 不通知
3. **`backend/internal/service/git_sync_worker.go` 的 `commitNow`**：进入实际 commit 前再读一次 `feature_flags.git`，false 时直接 return（防御性兜底，覆盖定时任务、配置变更回调等所有触发路径）

读取 `feature_flags` 的方式：worker 已有 `spaceService` 句柄，调用新增的 `spaceService.GetFeatureFlags(slug)`（或等价方法）即可。

### 前端

#### 类型与 API

`frontend/src/api/spaces.ts`：

```ts
export interface FeatureFlags { git: boolean; }

export interface Space {
  id: number; name: string; slug: string;
  icon?: string; description?: string;
  feature_flags: FeatureFlags;
  created_at: string; updated_at: string;
}

// spacesApi 新增：
updateFeatureFlags: async (slug: string, flags: FeatureFlags): Promise<FeatureFlags> => {
  const response = await apiClient.put<{ feature_flags: FeatureFlags }>(
    `/spaces/${slug}/feature-flags`, flags
  );
  return response.data.feature_flags;
}
```

#### AdminPage.tsx 内联面板

在 `renderInlinePanel(true)`（编辑模式）的"成员"区块**上方**插入：

```tsx
<div className="mb-3 pb-3 border-b border-notion-border">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={spaceFormData.feature_flags?.git ?? false}
      onChange={(e) => handleToggleGitFeature(e.target.checked)}
      className="w-4 h-4 rounded border-notion-border"
    />
    <span className="text-sm text-notion-text">Git 管理</span>
  </label>
</div>
```

样式要点：
- 复选框 + "Git 管理"标签横向排列
- 下方与"成员"区之间用 `border-b` 分隔线
- 不加"功能"小标题

`handleToggleGitFeature` 行为：**乐观更新** —— 先修改本地 `spaceFormData.feature_flags.git`，立即调用 `spacesApi.updateFeatureFlags`；失败时回滚并 toast。无需保存按钮，和"添加成员"一致。

#### Sidebar.tsx 显示条件

`frontend/src/components/Layout/Sidebar.tsx` 第 348 行附近：

```diff
- {gitState?.is_repo && (
+ {currentSpace?.feature_flags?.git && gitState?.is_repo && (
```

即：**功能开关 ON** 且 **目录是 git 仓库** 才显示按钮。

## 错误处理

| 场景 | 行为 |
|---|---|
| 解析 `feature_flags` JSON 失败（脏数据） | 当作默认值 `{}`，记录 warn 日志 |
| 非 admin 调用 `PUT /feature-flags` | 403 |
| git 关闭状态下调用 git 接口 | 403 + 明确错误信息 |
| 前端 toggle 调用失败 | 回滚 UI + 错误提示 |

## 测试要点

- 新建空间 → `feature_flags` 默认 `{}`，前端展示 `[ ] Git 管理`
- 勾选 → 接口持久化、Sidebar 按钮在 is_repo 时出现
- 取消勾选 → git 接口全部 403、worker 不再 commit
- 已存在自动 commit 配置的空间，关闭开关后，文件保存不再产生 commit
- 老 space（迁移前已有 git 仓库）默认状态为关闭，符合 B 决策

## 风险与边界

- **破坏性变更**：所有现有空间迁移后默认 git 关闭，依赖自动 commit 的用户需要手动重新开启。这是 B 选项的已知代价，需在升级说明里写清。
- **Worker 并发**：worker 读 `feature_flags` 与 commit 之间存在 TOCTOU，但有 API 层和 markGitDirty 层两道前置拦截，commitNow 的检查作为最后兜底足够。
- **未来扩展**：新增非 git 开关时，只需要在 `FeatureFlags` 加字段 + 在前端面板加一行 checkbox，schema 不变。
