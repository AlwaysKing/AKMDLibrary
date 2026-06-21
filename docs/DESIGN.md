# MD 知识库系统 — 设计文档

> 日期：2026-05-07
> 状态：已确认，待实施

## 1. 项目概述

一个基于目录结构存储 Markdown 文件的知识库系统。前端复刻 Notion 风格 UI，后端使用 Golang，编辑器使用 BlockNote（Fork）。支持多用户和空间级权限管理。

### 核心原则

- **MD 文件是唯一数据源**：所有页面内容以 Markdown 文件形式存储在文件系统上，可直接在外部编辑或喂给 AI 助手
- **简单至上**：去掉 Outline 的复杂权限管理、外部认证、实时协作等，只保留核心知识库功能
- **Notion 风格**：UI 复刻 Notion 的布局和交互体验

## 2. 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | BlockNote 原生 React，选定 BlockNote 后确定 |
| 构建工具 | Vite | 快速开发体验 |
| 状态管理 | Zustand | 轻量，简单够用 |
| 样式 | Tailwind CSS | 快速实现 Notion 风格 UI |
| 编辑器 | BlockNote（Fork） | 基于 TipTap/ProseMirror，Notion 风格块编辑器 |
| HTTP | Axios | API 调用 |
| 图标 | Lucide React | 图标库 |
| 后端 | Golang | REST API 服务 |
| 数据库 | SQLite（嵌入式） | 用户/权限/元数据 |
| 内容存储 | 文件系统 | Markdown 文件 |
| 部署 | Docker | Go 嵌入 React 静态资源，单容器部署 |

### BlockNote 引入方式

采用 **Fork + Git Submodule** 方式引入 BlockNote：
- 可以随时修改源码（如修复块手柄不能切换样式等问题）
- 可选择性合并上游更新（bugfix、新功能）
- 编辑器代码与业务代码物理隔离

## 3. 整体架构

```
┌─────────────────────────────────────────────────┐
│              Docker (单容器)                      │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │          Go 二进制 (:3000)                  │  │
│  │                                              │  │
│  │  /              → React SPA 静态资源          │  │
│  │                   (Go embed 嵌入)             │  │
│  │  /api/auth/*   → 认证接口                    │  │
│  │  /api/spaces/* → 空间管理                    │  │
│  │  /api/pages/*  → 页面 CRUD                   │  │
│  │  /api/users/*  → 用户管理（管理员）            │  │
│  │  /api/upload/* → 文件上传                    │  │
│  │  /*notfound    → SPA fallback (index.html)   │  │
│  │                                              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │
│  │  │ SQLite   │ │ docs/    │ │ data/    │    │  │
│  │  │ data.db  │ │ (MD 文件) │ │ uploads  │    │  │
│  │  └──────────┘ └──────────┘ └──────────┘    │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  全部挂载到宿主机 Volume 实现持久化                  │
└─────────────────────────────────────────────────┘
```

### 开发 vs 部署

| | 本地开发 | 生产部署 |
|---|---------|---------|
| 前端 | `vite dev` :5173（热重载） | 多阶段 Dockerfile |
| 后端 | `go run` :8080 | npm build → go build (embed) |
| 通信 | Vite proxy `/api` → :8080 | 同一端口，无跨域 |
| 部署 | — | `docker-compose up -d` |

## 4. 文件系统 → 数据映射

### 目录结构规则

```
docs/                                ← 文档根目录（配置指定路径）
├── 工作空间/                        ← Space (直接子文件夹 = 空间)
│   ├── README.md                    ← Page (MD 文件 = 页面)
│   ├── 项目文档.md                   ← Page
│   ├── 项目文档/                     ← PageChildren (与 .md 同名 = 子页面)
│   │   ├── 需求分析.md               ← Child Page
│   │   └── 需求分析/                 ← 更深层子页面
│   │       └── 详细需求.md
│   ├── 功能介绍.md                   ← Page
│   └── 功能介绍/                     ← PageChildren
│       ├── 文件外发.md               ← Child Page
│       └── _assets/                  ← 功能介绍.md 的资源目录
│           └── {uuid}/{uuid}/图片.png
└── 个人笔记/                        ← Space
    ├── 日记.md
    └── _assets/                      ← 根级资源（可选）
        └── {uuid}/{uuid}/video.mp4

data/                                ← 系统数据目录（与 docs 分离）
├── data.db                          ← SQLite 数据库
└── uploads/                         ← 封面图等系统级上传文件
```

### 映射规则

1. `docs/` 下的直接子文件夹 = **Space**（`_assets/` 除外）
2. `.md` 文件 = **Page**
3. 与 `.md` 同名的文件夹 = 该 Page 的**子页面目录**
4. `_assets/` = 当前目录层级页面引用的**资源**（图片/视频等），不作为页面或空间处理
5. 子页面目录内的 `.md` = 子 Page（**递归**，每层都可有 `_assets/`）
6. 以 `.` 开头的文件/文件夹忽略（如 `.DS_Store`）
7. MD 中用相对路径引用资源：`![](_assets/uuid1/uuid2/图片.png)`

## 5. 数据库设计（SQLite）

### users — 用户表

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | 主键，自增 |
| username | TEXT | 用户名，唯一 |
| password_hash | TEXT | bcrypt 密码哈希 |
| display_name | TEXT | 显示名称 |
| avatar_url | TEXT | 头像地址 |
| role | TEXT | 角色: "admin" \| "user" |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### spaces — 空间表

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | 主键，自增 |
| name | TEXT | 空间名称（= 文件夹名） |
| slug | TEXT | URL 友好标识，唯一 |
| icon | TEXT | 空间图标 (emoji)，可选 |
| description | TEXT | 空间描述 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

注：空间的排序和层级由文件系统目录结构决定，表中只存额外元数据。

### pages — 页面元数据表

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | 主键，自增 |
| space_id | INTEGER | 所属空间 → spaces.id |
| title | TEXT | 页面标题（从文件名或首行提取） |
| file_path | TEXT | 相对于 docs/ 的 MD 文件路径 |
| icon | TEXT | 页面图标 (emoji)，可选 |
| cover_url | TEXT | 封面图 URL，可选 |
| sort_order | REAL | 同级排序（支持拖拽排序） |
| created_at | DATETIME | |
| updated_at | DATETIME | |

注：页面内容存在 MD 文件中，表中只存元数据。封面和图标都是**可选的**，用户可随时添加或移除。

### space_members — 空间权限表

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | 主键 |
| space_id | INTEGER | → spaces.id |
| user_id | INTEGER | → users.id |
| role | TEXT | "admin" \| "editor" \| "viewer" |
| created_at | DATETIME | |

权限说明：
- **space admin**：管理空间成员
- **editor**：编辑页面
- **viewer**：只读

## 6. REST API 设计

### 认证

```
POST   /api/auth/login              ← 登录，返回 JWT
POST   /api/auth/logout             ← 登出
GET    /api/auth/me                 ← 获取当前用户信息
```

### 用户管理（仅 admin）

```
GET    /api/users                   ← 用户列表
POST   /api/users                   ← 创建用户
PUT    /api/users/:id               ← 更新用户
DELETE /api/users/:id               ← 删除用户
```

### 空间

```
GET    /api/spaces                  ← 当前用户可访问的空间列表
GET    /api/spaces/:slug            ← 空间详情
POST   /api/spaces                  ← 创建空间（创建文件夹 + DB 记录）
PUT    /api/spaces/:slug            ← 更新空间信息
DELETE /api/spaces/:slug            ← 删除空间
GET    /api/spaces/:slug/members    ← 空间成员列表
POST   /api/spaces/:slug/members    ← 添加成员
PUT    /api/spaces/:slug/members/:id← 更新成员角色
DELETE /api/spaces/:slug/members/:id← 移除成员
```

### 页面

```
GET    /api/spaces/:slug/pages               ← 页面树（递归返回子目录结构）
GET    /api/spaces/:slug/pages/:id            ← 获取页面内容（读 MD → 转 JSON）
POST   /api/spaces/:slug/pages               ← 创建页面（写 MD + DB 记录）
PUT    /api/spaces/:slug/pages/:id            ← 更新页面内容（MD 写回）
PUT    /api/spaces/:slug/pages/:id/meta       ← 更新元数据（封面/图标/排序）
DELETE /api/spaces/:slug/pages/:id            ← 删除页面（删 MD + 同名文件夹）
GET    /api/spaces/:slug/pages/:id/assets/*   ← 服务页面 _assets/ 下的资源
```

### 文件上传

```
POST   /api/upload                  ← 上传图片/文件
       → 保存到对应页面目录的 _assets/{uuid}/{uuid}/文件名
       → 返回相对路径用于 MD 中引用
GET    /api/upload/:filename        ← 获取上传的文件（封面图等系统级资源）
```

## 7. 前端架构

### 目录结构

```
frontend/src/
├── App.tsx                         ← 根组件（路由定义）
├── main.tsx                        ← 入口
├── api/                            ← API 调用封装
│   ├── client.ts                   ← Axios 实例 + JWT 拦截器
│   ├── auth.ts                     ← 登录/登出/me
│   ├── spaces.ts                   ← 空间 CRUD
│   ├── pages.ts                    ← 页面 CRUD + 内容
│   ├── users.ts                    ← 用户管理
│   └── upload.ts                   ← 文件上传
├── stores/                         ← Zustand 状态管理
│   ├── authStore.ts                ← 登录态、当前用户
│   ├── spaceStore.ts               ← 空间列表、当前空间
│   └── pageStore.ts                ← 页面树、当前页面
├── components/
│   ├── Layout/
│   │   ├── AppLayout.tsx           ← 主布局（侧边栏 + 内容区）
│   │   └── Sidebar.tsx             ← Notion 风格侧边栏
│   ├── Sidebar/
│   │   ├── SpaceSelector.tsx       ← 空间切换下拉
│   │   ├── PageTree.tsx            ← 页面树（递归组件）
│   │   ├── PageTreeItem.tsx        ← 单个页面项（展开/折叠/选中）
│   │   └── NewPageButton.tsx       ← 新建页面按钮
│   ├── Editor/
│   │   ├── PageEditor.tsx          ← 编辑器主组件（封装 BlockNote）
│   │   ├── CoverImage.tsx          ← 封面图（可选，上传/更换/移除）
│   │   ├── PageIcon.tsx            ← 页面图标（可选，emoji 选择器）
│   │   └── Breadcrumb.tsx          ← 面包屑导航
│   └── Auth/
│       ├── LoginPage.tsx           ← 登录页
│       └── ProtectedRoute.tsx      ← 路由守卫
├── pages/
│   ├── LoginPage.tsx               ← /login
│   ├── SpacePage.tsx               ← /s/:spaceSlug
│   ├── PageViewPage.tsx            ← /s/:spaceSlug/p/:pageId
│   └── AdminPage.tsx               ← /admin
├── hooks/
│   ├── useAuth.ts
│   └── usePage.ts
└── styles/
    └── globals.css                 ← 全局样式 + Tailwind 指令
```

### 路由设计

```
/login                          ← 登录页（未登录时所有路由重定向到这里）
/s/:spaceSlug                   ← 空间首页（显示空间下页面列表）
/s/:spaceSlug/p/:pageId         ← 页面编辑（核心页面：侧边栏 + 编辑器）
/admin                          ← 管理后台（仅 admin 可见）
  ├── 用户管理
  └── 空间管理
```

### 核心交互流程

**打开页面：**
1. 路由匹配 `/s/:spaceSlug/p/:pageId`
2. `pageStore` 请求 `GET /api/spaces/:slug/pages/:id`
3. 后端读取 .md 文件 → 转换为 BlockNote JSON → 返回
4. `PageEditor` 用 BlockNote 渲染 JSON
5. 封面/图标为可选，有数据显示，没有则显示「添加」按钮

**编辑保存：**
1. 用户编辑（可配置自动保存间隔或手动保存）
2. BlockNote JSON → 转换为 Markdown
3. `PUT /api/spaces/:slug/pages/:id` → 后端写入 .md 文件

**侧边栏页面树：**
1. `spaceStore` 请求 `GET /api/spaces/:slug/pages`
2. 后端扫描目录结构 → 返回树形 JSON
3. `PageTree` 递归渲染树节点
4. 点击节点 → 导航到对应页面
5. 拖拽排序 → `PUT /api/spaces/:slug/pages/:id/meta`

## 8. 功能范围

### 已纳入

- ✅ 核心编辑器（BlockNote：块编辑、`/` 命令、富文本格式、代码块、表格、引用、待办列表、图片上传）
- ✅ 封面图 + 页面图标（**可选**，用户可添加/移除）
- ✅ 可折叠侧边栏 + 空间切换
- ✅ 多用户 + 空间级权限（管理员添加用户，空间级 admin/editor/viewer）
- ✅ Notion 风格 UI 复刻

### 已排除

- ❌ 全局搜索
- ❌ 数据库视图（表格/看板/日历）
- ❌ 实时多人协作
- ❌ 页面评论 / 讨论
- ❌ 版本历史
- ❌ 外部认证（OAuth 等）

## 9. 后端架构（Go）

```
backend/
├── cmd/
│   └── server/main.go         ← 入口
├── internal/
│   ├── handler/                ← HTTP 处理层（路由 → 请求解析 → 调用 service）
│   ├── service/                ← 业务逻辑层（文件操作、权限校验、格式转换）
│   ├── repository/             ← 数据访问层（SQLite 查询）
│   ├── model/                  ← 数据模型（User, Space, Page, SpaceMember）
│   └── middleware/             ← 中间件（JWT 鉴权、CORS、日志）
├── pkg/
│   ├── markdown/               ← MD ↔ BlockNote JSON 转换
│   └── filesystem/             ← 文件系统操作（扫描目录、读写 MD）
├── go.mod
└── Dockerfile                  ← 多阶段构建
```

### 关键技术点

- **JWT 认证**：登录后返回 JWT token，前端存 localStorage，Axios 拦截器自动附加
- **Markdown ↔ BlockNote JSON 转换**：`pkg/markdown/` 模块负责双向转换
- **目录扫描**：`pkg/filesystem/` 递归扫描 docs/ 目录，构建页面树
- **_assets/ 资源服务**：Go 静态文件服务，映射 `_assets/` 路径到实际文件系统

## 10. 部署

### Dockerfile（多阶段构建）

```
Stage 1: Node → npm install → npm build → dist/
Stage 2: Go → go build (embed frontend/dist/) → 单二进制
Stage 3: 运行阶段（最小镜像）
```

### docker-compose.yml

```yaml
services:
  knowledge-base:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./docs:/app/docs        # MD 文件持久化
      - ./data:/app/data        # SQLite + uploads 持久化
    environment:
      - JWT_SECRET=xxx
      - DATA_DIR=/app/data
      - DOCS_DIR=/app/docs
```

### 配置

通过环境变量或 config.yaml 配置：
- `PORT`：监听端口（默认 3000）
- `DOCS_DIR`：文档根目录路径
- `DATA_DIR`：系统数据目录路径
- `JWT_SECRET`：JWT 签名密钥
- `UPLOAD_DIR`：上传文件目录
