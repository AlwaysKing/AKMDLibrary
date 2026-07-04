# AKMDLibrary 目录结构规范

本文件说明 AKMDLibrary 知识库**文件系统的组织方式**：space 与 page 如何映射到磁盘目录、资源与共享文件的存放规则、UUID 的用法、哪些目录有特殊语义。

面向对象：编写或修改 MD 文件的 Agent、外部脚本、内容迁移工具、直接 SSH/git 操作仓库的人。

> 与 [FORMATS.md](./FORMATS.md) 互补：FORMATS.md 讲"MD 文件内部的语法"，本文件讲"MD 文件及其相关资源如何在文件系统里组织"。

---

## 一、顶层布局

容器内绝对路径 `/app/docs/`，对应宿主机 `userdata/docs/`（通过 VOLUME 挂载）。所有知识库内容都活在这一层。

```
/app/docs/                          ← 所有 space 的根（docsRoot）
├── <space-name>/                   ← 一个 Space = 一个直接子目录
│   ├── <page>.md                   ← 一个 Page = 一个 .md 文件
│   ├── <page>/                     ← 与 .md 同名的文件夹 = 该 Page 的资源/子页面目录
│   │   ├── _assets/                ← 该 Page 私有的媒体资源
│   │   └── <child-page>.md         ← 该 Page 的子页面
│   └── _files/                     ← Space 级共享文本文件池
└── <other-space>/                  ← 另一个 Space
```

**关键约束**：

- Space 的目录名 = `space.Name`（与 slug 对应，目录创建时按 Name 落盘）
- Page 的 `.md` 文件名即页面标题（保存时按标题重命名文件）
- 父子页面关系**仅通过"同名文件夹"表达**，不靠 frontmatter id 链

---

## 二、Space 层（`docs/<space-name>/`）

每个 Space 是 docsRoot 下的**直接子目录**。

```
docs/my-wiki/
├── README.md                       ← Space 的首页（约定俗成，非强制）
├── 设计文档.md
├── 设计文档/                       ← "设计文档.md" 的同名文件夹
│   └── ...
├── _assets/                        ← Space 根下也可以有 _assets（一般留空）
└── _files/                         ← Space 级共享文件池（见第四节）
```

### 扫描器忽略规则

`pkg/filesystem/scanner.go` 在列举 space / page 时会跳过：

| 模式 | 行为 |
|------|------|
| 名字以 `.` 开头（`.DS_Store`、`.git/`、`.gitignore`） | 整个忽略 |
| 名字为 `_assets` | 不作为 page 处理（视为资源目录） |
| 名字为 `_files` | 不作为 page 处理（视为共享文件池） |

其他 `.md` 文件 / 子目录都会被识别为 page 或 page 容器。

---

## 三、Page 层（`.md` 文件 + 同名文件夹）

### 3.1 一个 Page = 一个 `.md` 文件

```
docs/my-wiki/需求规格.md            ← 这是一个 Page
```

Page 的标题就是文件名（不含 `.md`）。重命名页面 = 重命名 `.md` 文件 + 重命名同名文件夹（**必须同步**，否则会丢失父子关系）。

### 3.2 同名文件夹表达父子层级

```
docs/my-wiki/需求规格.md            ← 父页面
docs/my-wiki/需求规格/              ← "需求规格"的同名文件夹
├── 登录模块.md                     ← 子页面
├── 登录模块/                       ← 子页面也有自己的同名文件夹
│   └── 边界场景.md                 ← 孙子页面
└── 支付模块.md
```

**约束**：

- 只有"父 .md 同名文件夹"内的 `.md` 才是该父页面的子页面
- 同名文件夹内**不能**放任意 `.md` 然后期望它属于别的父——文件系统层级的父就是目录层级
- 层级深度无硬限制，但建议 ≤ 4 层（编辑器 UI 渲染友好）

### 3.3 Page 的 frontmatter id

每个 page 在 `.md` 文件最顶部（可选）有 YAML frontmatter，其中 `id` 是 32 位 hex UUID：

```yaml
---
id: f5effe5f25824fa784fdddf21243f08a
---
```

**重要**：

- `id` 由后端在首次创建页面时生成（`uuidutil.NewPageID()`，32 位 hex 无连字符）
- **不要手编 id**，也**不要把 id 写进文件名**（文件名是标题）
- id 用于跨页面引用（`<page-ref data-id="...">`、`<sub-page data-id="...">`），即使目标页面被改名/移动位置，引用仍有效
- 如果扫描时发现 frontmatter 缺 id，后端会生成新 id 但**不在此时写回文件**——延迟到 page_service 的 enrichment 阶段统一写

---

## 四、`_assets/`：Page 私有媒体资源

每个 Page（即每个 `.md` 文件）可以在它的**同名文件夹**内拥有 `_assets/` 目录，存放该 Page 引用的图片、视频、音频、文件附件。

### 4.1 目录布局：UUID 二级分层

```
docs/my-wiki/需求规格/
└── _assets/
    └── f3a2...c1b8/                ← 每次上传生成一个 UUID 子目录
        └── screenshot.png          ← 实际文件落在 UUID 目录里
```

**为什么每次上传都新建 UUID 子目录**：

- **隔离**：不同 page、不同次上传的文件不会互相覆盖
- **去重免冲突**：同名文件（如 `screenshot.png`）可以并存
- **删除追踪**：知道某个资源属于"哪一次上传事件"，便于审计和清理

UUID 子目录名是 32 位 hex（与 page id 同格式）。`UploadAsset` 在 `page_service.go:782` 实现：每次调用都生成新 UUID 作为子目录，文件存为 `<uuid>/<original-filename>`。

### 4.2 引用方式

在 MD 文件内通过媒体块（`<image-block>` / `<video-block>` / `<audio-block>` / `<file-block>`）引用：

```markdown
<image-block url="./_assets/f3a2...c1b8/screenshot.png" caption="登录界面" width="600"></image-block>
```

`url` 三种写法等价（前端会归一化）：

- `./_assets/uuid/filename` ← 推荐，最明确
- `_assets/uuid/filename`
- `/_assets/uuid/filename`

前端渲染时自动转换为 `/api/spaces/<slug>/pages/<pageId>/assets/<path>` 调后端读取。

### 4.3 给 Page 添加新资源的正确方式

**Agent / 脚本要给某个 page 加图片时**：

1. 找到目标 page 的 `.md` 文件路径，得到同名文件夹
2. 在同名文件夹下创建 `_assets/<new-uuid>/`（自己生成一个 32 位 hex UUID）
3. 把图片复制为 `_assets/<new-uuid>/<filename>`
4. 在 `.md` 里用 `<image-block url="./_assets/<new-uuid>/<filename>" />` 引用

**不要**：

- ❌ 直接把图片放到 `_assets/` 根下（必须有 UUID 子目录）
- ❌ 复用别人 page 的 `_assets`（路径会跨页失效）
- ❌ 把资源放到 space 根目录期望能被引用（前端只认 `./_assets/...` 这种相对当前 page 的路径）

### 4.4 图标 / 封面用的资源

Page frontmatter 的 `icon` 和 `cover` 字段也可以引用本地资源：

```yaml
---
icon: "./_assets/f3a2...c1b8/logo.png"
cover: "./_assets/f3a2...c1b8/hero.jpg"
---
```

约定同上：必须落在该 page 同名文件夹的 `_assets/<uuid>/` 下。

---

## 五、`_files/`：Space 级共享文本文件池

每个 Space 在**根目录**下有 `_files/` 子目录，是 space 级共享的文本文件池。供 `<content />` 块引用，支持任意深度子目录。

```
docs/my-wiki/_files/
├── config.json
├── scripts/
│   ├── deploy.sh
│   └── migrate.sql
└── notes/
    └── 会议纪要.md
```

### 5.1 引用方式

用 `<content />` 块（详见 FORMATS.md 第九章）：

```markdown
<content file="_files/scripts/deploy.sh" lang="bash" />
```

**约束**：

- `file` 路径**必须以 `_files/` 开头**（防穿越），相对 space 目录
- 文件大小：上传限制 10MB；页面加载注入限制 1MB（超出则在页面上显示"加载失败"）
- 用户在页面里编辑 `<content />` 块 → 保存 → 后端把新内容**写回 `_files/<path>`**（MD 文件本身不存文件正文）
- 外部用 git/SSH 直接改 `_files/` 下的文件 → 下次打开页面天然反映最新内容（实时读盘）

### 5.2 `_files/` vs `_assets/` 的区别

| 维度 | `_assets/` | `_files/` |
|------|------------|-----------|
| 作用域 | Page 私有（在 page 同名文件夹下） | Space 全局共享（在 space 根下） |
| 目录结构 | `_assets/<uuid>/<file>` | `_files/<任意子目录>/<file>` |
| 引用方式 | 媒体块的 `url` 属性 | `<content />` 块的 `file` 属性 |
| 是否可编辑（在页面里） | 否（替换式覆盖） | 是（双向同步） |
| 设计意图 | 媒体附件、隔离防冲突 | 配置/脚本/长文本，可在页面内编辑 |

---

## 六、新增页面 / 资源时的操作清单

### 6.1 新建一个 Page

```
docs/my-wiki/新页面.md
```

写入 frontmatter（可选）+ 正文：

```markdown
---
icon: "📄"
---

# 新页面

正文内容……
```

后端扫描时发现这个 `.md`，会自动建库（如果缺 id 会补一个）。**不要**手编 id 字段。

### 6.2 新建一个子 Page

放到父 page 的同名文件夹内：

```
docs/my-wiki/父页面/子页面.md
```

`父页面.md` 与 `父页面/` 必须同时存在；如果没有同名文件夹，后端会在保存子页面时自动创建。

### 6.3 给 Page 加图片

详见 [4.3](#43-给-page-添加新资源的正确方式)。简言之：

```bash
# 假设要把 photo.png 加到 docs/my-wiki/MyPage.md
UUID=$(uuidgen | tr -d '-' | tr 'A-F' 'a-f')   # 32 位 hex
mkdir -p docs/my-wiki/MyPage/_assets/$UUID
cp photo.png docs/my-wiki/MyPage/_assets/$UUID/
```

然后在 `MyPage.md` 里：

```markdown
<image-block url="./_assets/$UUID/photo.png" caption="..."></image-block>
```

### 6.4 给 Space 加共享文本文件

直接放到 `_files/`：

```bash
mkdir -p docs/my-wiki/_files/scripts
cp deploy.sh docs/my-wiki/_files/scripts/
```

在任意 page 里：

```markdown
<content file="_files/scripts/deploy.sh" lang="bash" />
```

---

## 七、禁止 / 容易踩的坑

| 错误 | 后果 |
|------|------|
| 直接把图片放在 `_assets/` 根下（没有 UUID 子目录） | 前端能访问但与项目约定不一致，清理脚本可能误删 |
| 手编 frontmatter 的 `id` 字段 | 与后端生成冲突，可能导致引用错乱 |
| 把 `_files` 路径写成 `_files/../etc/passwd` | 后端 `resolveFilesPath` 会拒绝（403） |
| 在 space 目录之外（如 `/tmp`）创建资源再硬链到 `_assets` | 跨设备硬链失败；请用 `cp` |
| 重命名 `.md` 时不同步重命名同名文件夹 | 父子关系断裂，子页面会被识别成"另一个父的子页"或孤儿 |
| 用相对路径 `../<other-page>/_assets/...` 引用别的 page 的资源 | 路径解析会失败；资源必须放在本 page 的 `_assets/` 内 |
| 在 `_files/` 里放二进制（图片、视频） | `<content />` 是按文本加载的；媒体请走 `_assets/` |

---

## 八、目录结构总览

```
/app/docs/                                  ← docsRoot（VOLUME 挂载点）
└── <space-name>/                           ← Space（直接子目录）
    ├── README.md                           ← Page（.md 文件）
    ├── README/                             ← Page 的同名文件夹
    │   ├── _assets/                        ← Page 私有资源
    │   │   └── <uuid32>/<filename>         ← UUID 二级目录
    │   └── <child-page>.md                 ← 子 Page
    ├── <other-page>.md                     ← 同 space 内另一 Page
    ├── <other-page>/                       ← 它的同名文件夹
    │   └── _assets/<uuid32>/<filename>
    └── _files/                             ← Space 共享文件池
        ├── <filename>
        └── <subdir>/<filename>
```

记忆口诀：

- **Space** 用一级目录划分
- **Page** 用 `.md` + 同名文件夹表达（文件夹就是它的"内部空间"）
- **资源** 进同名文件夹的 `_assets/<uuid>/`
- **共享文件** 进 space 根的 `_files/`
