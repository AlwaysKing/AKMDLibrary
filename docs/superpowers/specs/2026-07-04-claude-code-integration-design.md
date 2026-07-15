# Claude Code 集成

**日期**：2026-07-04
**作者**：AK
**状态**：待实现

## 背景

当前 AKMDLibrary 是一个自托管的多用户 Markdown 知识库（Go + chi 后端、React/TS 前端、Docker 部署）。希望在每个启用该功能的空间内集成 Claude Code 助手：用户在浏览/编辑文档时，可以通过右下角的悬浮按钮向 Claude 提问、让它读写当前空间内的文件。

参考实现：`/Users/alwaysking/AKProject/CCGUI`（Electron + Claude Code stream-json 协议）。本项目复用其 stream-json in/out + `--permission-prompt-tool stdio` 的进程模型，但前端协议与权限策略更简单。

## 目标

- Docker 镜像通过 `entrypoint.sh` 启动：根据环境变量创建指定 UID/GID 的 Linux 用户，在该用户身份下运行后端
- Claude Code 的 `settings.json` 与系统提示词持久化在 `data/claude/` 目录下，每次容器启动由 entrypoint 拷贝到运行用户的 `~/.claude/`
- 管理员后台新增 Claude 配置入口：编辑 `settings.json`（含 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 三个高亮字段）、编辑系统提示词、配置全局工具开关（Bash / Web）
- 每个空间可独立启用/禁用 Claude（与现有 Git feature flag 同级）
- 前端右下角悬浮按钮 → 可拖拽聊天面板；一个 WebSocket 连接 = 一个 Claude session；切换空间、刷新页面都开新会话
- 后端按 WebSocket 连接生命周期管理 Claude 子进程；自动处理工具权限请求：路径必须在当前空间内、写操作需要用户具备写权限、Bash/Web 工具由全局开关控制
- 工具被拒时前端显示明确的拒绝消息

## 非目标

- 不做会话历史持久化（WS 断开即结束，刷新即新会话）
- 不展示 Claude 的思考过程（thinking）
- 不展示工具调用详情（除了被拒绝的工具会显示一条系统消息）
- 不做流式增量渲染——虽然底层 stream-json，但**不启用** `--include-partial-messages`，前端拿到的是完整消息
- 不在本期做镜像里 Claude Code CLI 的安装（Dockerfile 中预留位置，但 CLI 安装步骤留待后续单独迭代）
- 不做单用户并发连接数限制（同一用户多个 tab 各开各的 session 是允许的）
- 不实现中断生成（生成途中用户无法点停；这版只能等回复完才能再发下一条）

## 设计

### 1. Docker Entrypoint

镜像以 root 启动。`entrypoint.sh` 检查 `USER_NAME` 等环境变量：

- **四个环境变量都未设置** → 跳过用户创建/切换，直接 `exec "$@"`（以容器默认用户身份运行，通常为 root）。适用于本地开发或不需要用户隔离的部署
- **任一环境变量已设置** → 创建/调整用户与组、建立 `~/.claude` 软链、`chown` 权限，然后切换到该用户执行后端

环境变量（仅在"已设置"模式下生效）：

| 变量 | 说明 |
|------|------|
| `USER_NAME` | 运行后端的 Linux 用户名 |
| `USER_ID` | UID |
| `GROUP_NAME` | 主组名 |
| `GROUP_ID` | GID |

四个变量必须同时设置；若只设了部分则在 entrypoint 报错退出，避免不一致状态。

参考实现：`/Users/alwaysking/AKProject/DocAgent/entrypoint.sh`（symlink + chown -h + 切换用户的模式）。

`entrypoint.sh` 关键步骤：

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

# ===== 创建/调整 group =====
if ! getent group "$GROUP_NAME" >/dev/null 2>&1; then
    groupadd -g "$GROUP_ID" "$GROUP_NAME"
else
    groupmod -g "$GROUP_ID" "$GROUP_NAME"
fi

# ===== 创建/调整 user =====
HOME_DIR="/home/$USER_NAME"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    useradd -u "$USER_ID" -g "$GROUP_ID" -m -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
else
    usermod -u "$USER_ID" -g "$GROUP_ID" -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
fi

# ===== 建立 ~/.claude 软链（指向 data/claude，admin 改完立即生效） =====
mkdir -p "$HOME_DIR/.claude"
mkdir -p /app/data/claude

# settings.json symlink
rm -f "$HOME_DIR/.claude/settings.json"
ln -sf /app/data/claude/settings.json "$HOME_DIR/.claude/settings.json"

# ===== 修正权限（含 symlink 自身） =====
chown -h "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude/settings.json"
chown -R "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude"
chown -R "$USER_NAME:$GROUP_NAME" /app/data /app/docs

# ===== 切换用户后执行原 command =====
exec runuser -u "$USER_NAME" -- "$@"
```

说明：

- **symlink 而非 copy**：`~/.claude/settings.json` 是指向 `/app/data/claude/settings.json` 的软链，admin 在 UI 里改 data/ 文件后立即对正在运行的 claude session 生效（下个 session 启动时即读到新内容）。无需重启容器
- **`system-prompt.md` 不需要 symlink**：每次启动 claude session 时后端直接读 `/app/data/claude/system-prompt.md` 内容，通过 `--append-system-prompt` 参数传入。系统提示词不是 claude 自动加载的文件
- **`chown -h`**：处理 symlink 自身的属主（不带 `-h` 会 chown 目标文件），参考 DocAgent
- **`runuser -u ... -- "$@"`**：来自 util-linux，Debian-slim 默认带；argv 透传干净（`su -c` 的 shell 引号问题回避了）

Dockerfile 改动：

- 基础镜像不变（debian-slim 系，`runuser` 默认就有）
- `COPY entrypoint.sh /app/entrypoint.sh` + `RUN chmod +x /app/entrypoint.sh`
- `ENTRYPOINT ["/app/entrypoint.sh"]`
- `CMD` 不变（启动后端的命令）
- Dockerfile 预留 Claude Code CLI 安装位置（注释占位，本期不实际安装）

### 2. 配置存储

```
文件系统（持久化 volume，挂载在 /app/data）：
├── data/claude/settings.json      # Claude Code 原生配置（env 等）
└── data/claude/system-prompt.md   # 默认系统提示词

数据库 site_settings 表（key-value，已有 favicon/logo/site_name）：
└── claude_tool_config             # JSON: {"allow_bash": false, "allow_web": false}

数据库 spaces 表（已有）：
└── feature_flags                  # JSON: {"git": false, "claude": false}
```

为什么这样切：

- `settings.json` 与 `system-prompt.md` 是 Claude Code 直接消费的文件，必须落到 `~/.claude`，放 volume 跟着 `./data` 走最自然
- 工具开关是 AKMDLibrary 自定义逻辑读取的、不进 Claude Code 原生配置，存 DB 与 `favicon`/`logo` 一致
- Space 级 Claude 启用开关走 `feature_flags`，与 Git 同模式（参考 `2026-06-25-space-feature-flag-git-design.md`）

#### 文件初始化

后端启动时（`main.go` 初始化阶段）确保 `data/claude/` 目录存在，不存在则创建空骨架：

- `settings.json`：`{}` 或带 `env: {}` 的骨架
- `system-prompt.md`：空文件

管理员保存配置时只写 `data/claude/*`——因为 entrypoint 已经把 `~/.claude/settings.json` 建成指向 `data/claude/settings.json` 的 symlink，写 data 即等价于写 home。系统提示词直接从 data 目录读出通过 `--append-system-prompt` 传给 claude，不需要 home 里有文件。

### 3. Space Feature Flag 扩展

`backend/internal/model/space.go`：

```go
type FeatureFlags struct {
    Git    bool `json:"git"`
    Claude bool `json:"claude"` // 新增
}

func DefaultFeatureFlags() FeatureFlags {
    return FeatureFlags{Git: false, Claude: false}
}
```

存量空间的 `feature_flags` JSON 没有新字段时反序列化为零值（false），符合"默认关闭"的预期，无需迁移脚本。

Space 管理界面（前端）在已有的 Git 复选框旁边加一个 Claude 复选框，UI 模式完全一致。

### 4. 管理员后台 Claude 配置页

在 `AdminPage.tsx` 的 tab 列表里新增一项 **「Claude」**（仅站点管理员可见）。

页面结构（自上而下）：

1. **环境变量快速配置区**（三个高亮输入框，从 `settings.json.env` 提取）
   - `ANTHROPIC_AUTH_TOKEN`（password input）
   - `ANTHROPIC_BASE_URL`（text input）
   - `ANTHROPIC_MODEL`（text input）
   - 保存时合并回 `settings.json.env`，保留 `env` 里其他用户自定义的键
2. **settings.json 完整编辑器**（textarea + JSON 校验）
   - 管理员可粘贴任意合法的 Claude Code settings 内容
   - 校验通过后整份保存
   - 上面的环境变量区是这一区的"便捷视图"，两边联动：编辑 env 字段同步更新 JSON 显示，编辑 JSON 同步解析回字段（解析失败时字段保持原值）
3. **系统提示词**（textarea）
4. **工具权限开关**
   - `允许 Bash` （checkbox，默认关）
   - `允许 Web 工具（WebSearch / WebFetch）`（checkbox，默认关）
5. **保存按钮**

保存逻辑：

1. 把 `settings.json` 写到 `data/claude/settings.json` 并同步到 `~/.claude/settings.json`
2. 把系统提示词写到 `data/claude/system-prompt.md`
3. 把工具开关 JSON 写到 `site_settings` 表的 `claude_tool_config` 键

后端新增 handler/service：

- `GET /api/admin/claude/config` — 返回 `{settings_json, system_prompt, tool_config}`
- `PUT /api/admin/claude/config` — 接收上述完整对象，原子写入

两个接口都走管理员鉴权中间件。

### 5. 后端 WebSocket 与 Claude Session 管理

#### 路由

```
GET /api/spaces/{slug}/claude/ws
```

JWT 鉴权 + space 成员校验 + space `feature_flags.claude == true` 校验。任一不满足直接 403/404，不升级 WebSocket。

#### 新增文件

- `backend/internal/handler/claude_handler.go` — HTTP 升级 WebSocket、生命周期管理
- `backend/internal/service/claude/session.go` — 单个 Claude 子进程封装
- `backend/internal/service/claude/manager.go` — `conn → session` 映射，断开时清理
- `backend/internal/service/claude/permission.go` — 工具权限判断
- `backend/internal/service/claude/protocol.go` — stream-json 消息结构与序列化

#### WebSocket 协议

前端 → 后端：

```json
{ "type": "user_message", "content": "用户输入的文本" }
```

后端 → 前端，4 种事件：

```json
{ "type": "status", "status": "answering" | "idle" }
{ "type": "assistant_message", "content": "Claude 完整回复的文本" }
{ "type": "permission_denied", "tool": "Write", "path": "/etc/passwd", "reason": "..." }
{ "type": "error", "message": "..." }
```

`permission_denied` 的 `path` 字段对无路径概念的工具（如 `Bash`、`WebSearch`）可省略。

#### Claude 子进程启动参数

```
claude \
  --print \
  --output-format stream-json \
  --input-format stream-json \
  --permission-prompt-tool stdio \
  --append-system-prompt "<data/claude/system-prompt.md 内容>"
```

**不带** `--include-partial-messages`——后端收到的就是完整 assistant 消息而不是 `text_delta`。

- `cwd` = space 对应的绝对路径（`docsDir/{spaceSlug}` 解析后）
- 环境变量：继承父进程（含 entrypoint 注入的 `HOME` 等）+ `settings.json.env` 覆盖
- stdin 写入 `user_message`：参考 CCGUI 的 `sendMessage` 格式
  ```json
  {
    "type": "user",
    "message": { "role": "user", "content": [{ "type": "text", "text": "..." }] }
  }
  ```

#### Session 生命周期

- WS 连接建立 → 校验 → 生成内部 sessionId → spawn claude → 注册到 manager
- 收到 `user_message` → 推送 `status: answering` → 转换为 stream-json user 消息写入 claude stdin
- claude stdout 来的消息：
  - `assistant` 整条消息 → 提取文本 → 推送 `assistant_message` → 推送 `status: idle`
  - `control_request`（权限请求）→ 走权限判断 → 写回 `control_response`（allow/deny）；deny 时同时给前端推 `permission_denied`
  - `result` → 忽略（不展示 token 用量）
  - 其他类型 → 忽略
- WS 断开 → SIGTERM claude 进程 → manager 移除映射

#### 权限判断（`permission.go`）

输入：tool_name、tool_input（map[string]any）、用户在该 space 的写权限、space 绝对路径（resolve 后）、`claude_tool_config`

输出：`(allowed bool, reason string)`

逻辑：

```
路径校验工具函数 resolveAndCheck(rawPath, spaceDir):
    abs = filepath.Abs(filepath.Join(spaceDir, rawPath))   // 处理相对路径
    abs = filepath.EvalSymlinks(abs)                        // 跟踪 symlink
    return strings.HasPrefix(abs, spaceDir + string(os.PathSeparator))

switch tool_name:
  case "Bash":
    if !tool_config.allow_bash:
        return (false, "Bash 工具已被全局禁用")
    return (true, "")

  case "WebSearch", "WebFetch":
    if !tool_config.allow_web:
        return (false, "网络工具已被全局禁用")
    return (true, "")

  case "Read", "Glob", "Grep":
    # 这三个工具的字段名：Read 有 file_path；Glob 有 path；Grep 有 path/cwd
    rawPath = extractPath(tool_name, tool_input)
    if !resolveAndCheck(rawPath, spaceDir):
        return (false, "路径不在当前空间范围内: " + rawPath)
    return (true, "")

  case "Write", "Edit", "MultiEdit":
    if !user_can_write:
        return (false, "当前用户在该空间没有写权限")
    # Write 有 file_path；Edit 有 file_path；MultiEdit 有 file_path
    rawPath = tool_input["file_path"]
    if !resolveAndCheck(rawPath, spaceDir):
        return (false, "路径不在当前空间范围内: " + rawPath)
    return (true, "")

  default:
    # TodoWrite、Task 等无副作用工具一律 allow
    return (true, "")
```

#### 用户写权限判定

```go
func userCanWriteInSpace(userID int, spaceID int) bool {
    member := memberRepo.FindByUserAndSpace(userID, spaceID)
    if member == nil {
        return false  // 不是成员 → WS 都连不上，理论上不会到这里
    }
    return member.Role == "editor" || member.Role == "admin"
}
```

站点管理员（`user.Role == "admin"`）不绕过 space 权限——他们仍需要被加入 space 的成员并赋予 `editor`/`admin` 角色才能在 Claude 会话里写文件。

### 6. 前端聊天组件

#### 新增文件

- `frontend/src/components/ClaudeChat/FloatingButton.tsx` — 右下角圆形悬浮按钮
- `frontend/src/components/ClaudeChat/ChatPanel.tsx` — 可拖拽聊天窗口
- `frontend/src/components/ClaudeChat/MessageList.tsx` — 消息列表渲染
- `frontend/src/components/ClaudeChat/MessageInput.tsx` — 输入框 + 发送按钮
- `frontend/src/hooks/useClaudeChat.ts` — WebSocket 连接 + 状态管理
- `frontend/src/api/claude.ts` — 配置接口（管理员页用）

#### 全局挂载

`App.tsx` 全局挂载 `<FloatingButton />`，路由无关。`FloatingButton` 内部：

- 监听当前 space（来自 user store 的 `last_active_space_slug` 或路由参数）
- 检查当前 space 的 `feature_flags.claude`：未启用 → 不渲染按钮
- 未登录 → 不渲染
- 点击 → 切换 `<ChatPanel />` 的 visible 状态

#### ChatPanel 行为

- 标题栏可拖动（使用项目现有的拖拽 hook 模式，若无则引入轻量实现）
- 默认尺寸 380×520，位置右下角偏上
- 打开时：建立 WS 连接（带 JWT query param 或 header）
- 关闭时：断开 WS、清空消息
- 切换 space（用户切换空间导致 `feature_flags.claude` 变化）时：
  - 旧 space 关闭 → 断开 WS、清空消息、回到隐藏状态
  - 新 space 是否启用 Claude 决定按钮是否显示
- 页面刷新：天然就是新 WS 连接 = 新 session（无需额外处理）

#### 消息渲染

`MessageList` 渲染三种气泡：

- `user` — 右对齐，主题色背景
- `assistant` — 左对齐，灰色背景，渲染 Markdown（复用项目现有 Markdown 渲染器）
- `system` — 居中、小字、红色（用于 `permission_denied` 和 `error`）

`permission_denied` 渲染示例：

> ⛔ 已拒绝 `Write` `/etc/passwd` — 路径不在当前空间范围内

#### 状态指示

输入框上方一行小字 + 加载图标：

- `idle` → 不显示
- `answering` → "Claude 正在思考..."（带 spinner）

#### 输入交互

- 多行 textarea
- `Enter` 发送，`Shift+Enter` 换行
- `answering` 状态下禁用发送按钮

## 接口契约

### 管理员配置接口

```
GET /api/admin/claude/config
200: {
  "settings_json": { ... Claude Code settings 对象 ... },
  "system_prompt": "字符串内容",
  "tool_config": { "allow_bash": false, "allow_web": false }
}

PUT /api/admin/claude/config
body: 同上
200: { "ok": true }
400: JSON 校验失败 / settings_json 不是合法 JSON
```

### WebSocket

```
GET /api/spaces/{slug}/claude/ws?token=<JWT>
Upgrade: WebSocket
鉴权: JWT 通过 query param ?token= 传递（浏览器 WebSocket API 无法设置 Authorization header）
返回: 升级为 WebSocket，双向文本帧（每帧一条 JSON 消息）
```

后端在升级前从 query 取 token，走与 `Authorization: Bearer` 相同的 JWT 校验逻辑。

## 错误处理

| 场景 | 行为 |
|------|------|
| Claude CLI 不存在（spawn 失败） | WS 建立 → 立即推 `{type:"error", message:"Claude CLI 未安装"}` → 关闭 WS |
| Claude 进程异常退出 | 推 `{type:"error", message:"会话异常退出"}` → 关闭 WS |
| settings.json 不是合法 JSON | 管理员保存接口返回 400；启动 claude session 时跳过 env 覆盖 |
| 权限判断异常（如 path 字段缺失） | 视为 deny，reason 写明异常原因 |
| 用户没有 space 成员关系 | HTTP 403，不升级 WS |
| Space 未启用 Claude feature | HTTP 404，不升级 WS |

## 测试策��

- 后端：
  - `permission.go` 路径校验单元测试（相对路径、绝对路径、symlink 逃逸、`../` 逃逸、嵌套）
  - `permission.go` 各 tool 分支单元测试（读用户/写用户 × 各工具 × 各开关）
  - WebSocket handler 集成测试：mock claude 子进程（用脚本模拟 stdin/stdout），验证协议转换
- 前端：
  - 切换 space 时 WS 正确断开重连
  - permission_denied 消息正确渲染
  - ansing 状态下禁用输入

## 实现顺序（建议）

1. Dockerfile + entrypoint.sh（容器能以指定用户跑起来）
2. Space FeatureFlags 加 `Claude` 字段 + 前端 space 管理加复选框
3. `data/claude/` 文件初始化 + 管理员配置接口 + 管理员后台 UI
4. Claude session 子进程封装 + 权限判断 + WebSocket handler
5. 前端悬浮按钮 + ChatPanel + WebSocket hook
6. 联调 + 路径逃逸测试

每一步可独立验收。
