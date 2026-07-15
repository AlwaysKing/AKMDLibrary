# File Content Block 设计

## 目标

新增一个 BlockNote 自定义 block 类型 `fileContent`，把"文件引用"和"代码块展示"结合：

- 类似 image/video，引用一个外部文件
- 在编辑器里以 code block 风格显示文件内容
- 用户在 block 中编辑 → 保存页面时同步写回文件
- 文件是 space 级别共享，多个页面引用同一文件时天然保持一致

## 目录结构

每个 space 在其根目录下开辟 `_files/` 子目录作为本 space 的共享文件池：

```
docs/<space-slug>/
├── _assets/        # 现有：页面的图片/附件资源
├── _files/         # 新增：space 共享文本文件池
│   ├── config.json
│   ├── scripts/
│   │   └── deploy.sh
│   └── notes/
│       └── meeting.md
└── some-page.md
```

支持子目录：用户可通过 SSH 等外部工具在 `_files/` 下自由组织子目录，block 通过相对路径引用。

## 存储格式

### 磁盘上（MD 文件中）

只保留 HTML 注释形式的引用，路径相对 space 目录：

```markdown
<!-- file: _files/config.json -->
```

特点：
- 不存内容，避免 MD 文件膨胀
- 文件被外部修改后，下次加载页面天然反映最新内容
- 多页面引用同一文件时，MD 互相独立但都指向同一份数据源

### BlockNote 内存中（编辑时）

block 同时持有：
- `path` prop：相对 space 的路径，如 `_files/config.json`
- 文本内容：作为 block 的 inline content，以 code block 风格渲染，可编辑

### API 传输格式（前后端之间）

为保持 MD 解析的单点逻辑，传输时也是 MD 形式，使用「HTML 注释 + 紧邻的 fenced code block」组合标识：

````markdown
<!-- file: _files/config.json -->
```json
{
  "name": "demo"
}
```
````

- 前端 BlockNote 的 `toMarkdown`：fileContent block 输出上面的组合
- 前端 BlockNote 的 `parse`：识别此组合 → 构造 fileContent block；否则按普通 code block 处理

## 后端流程

### 加载页面（enrich）

`PageService.Get` 返回 MD 内容前，扫描 `<!-- file: PATH -->`：
- 若已紧邻 fenced code block：保留原样（说明上次保存还没完成清洗，理论上不应出现）
- 否则：读取 `docs/<space-slug>/<PATH>` 文件内容（限制大小、限制路径必须在 `_files/` 下），按扩展名推断语言，把内容作为紧邻的 fenced code block 注入回去

### 保存页面（maintain）

`PageService.Update` 在写 MD 前调用 `maintainFileContentBlocks`：
- 正则匹配 `<!-- file: PATH -->\n```lang\nCONTENT\n```` 模式
- 对每个匹配：
  1. 校验 PATH 在 `_files/` 下（防路径穿越）
  2. 把 CONTENT 写到 `docs/<space-slug>/<PATH>`（自动创建父目录）
  3. 从 MD 中剥离 code block，仅保留 `<!-- file: PATH -->`
- 返回清洗后的 MD，写入磁盘

复用现有 `maintainSubpageBlocks` 的同款模式。

### 安全

- 所有路径解析后必须位于 `<space-slug>/_files/` 之内
- 拒绝 `..`、绝对路径、符号链接穿越
- 文件大小限制：上传 10MB；加载注入 1MB（超出则不注入内容，block 显示提示）

## 后端 API

新建 `FilesHandler`，挂在 `/api/spaces/{slug}/files` 路由组下，需要 space 成员权限：

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/spaces/{slug}/files` | 递归列出 `_files/` 下所有文件（路径、大小、mtime） |
| GET | `/api/spaces/{slug}/files/content?path=...` | 读取单个文件内容（text） |
| GET | `/api/spaces/{slug}/files/download?path=...` | 下载文件（Content-Disposition: attachment） |
| POST | `/api/spaces/{slug}/files/upload` | multipart 上传，form field `path`（可选，默认 `_files/<filename>`），`file` 为文件内容 |
| GET | `/api/spaces/{slug}/files/check?name=...` | 检查文件名是否可用（返回 `{available: bool}`） |
| PUT | `/api/spaces/{slug}/files/rename` | body `{from, to}`，重命名 / 移动 |
| DELETE | `/api/spaces/{slug}/files?path=...` | 删除文件 |

所有 path 参数都做 `_files/` 范围校验。

## 前端 Block Schema

`FileContentBlock.tsx`：

```ts
export const FileContentBlockSpec = createReactBlockSpec(
  {
    type: 'fileContent',
    propSchema: {
      path: { default: '' },
      language: { default: 'text' },
    },
    content: 'inline',  // 类似 code block，单行可编辑（实际是多行用 line breaks）
  },
  { render: FileContentComponent },
);
```

> 注：BlockNote 的 code block 用 `content: 'inline'` 配 multiline 实现，这里复用相同思路。

### 渲染规则

- **无 path（path=''）**：渲染一个 code-block 风格的空容器，居中显示 "点击引用文件"，点击触发 file picker 菜单
- **有 path**：
  - 顶部小标签栏显示 path（参考 code block 的语言标签位置）
  - 内容区使用 code block 主题（背景色、字体、padding 完全一致）
  - 内容可编辑
- 选中或 hover block 时，右上角浮出菜单按钮（参考 image block 的 toolbar 样式）：
  - "更换文件" → 打开 file picker
  - "下载" → 触发 download API
  - "在文件管理中打开" → 跳转到 `/s/<slug>/files`（可选）
  - "解除引用" → 清空 path，block 退化为普通 code block

## File Picker 菜单

参考封面/图标选择菜单的样式（已存在的 IconPicker / CoverPicker 风格）：

- 浮层卡片，两个 tab：
  1. **已有文件**：搜索框 + 文件列表（路径 + 大小 + mtime），点击选中
  2. **上传**：
     - 文件选择按钮（带预览名）
     - 选中后立即调用 `/files/check?name=...`，冲突时按钮禁用 + 红字提示
     - 点 "上传" 才真正 POST `/files/upload`
     - 上传成功后自动切回 "已有文件" tab 并选中刚上传的

## 文件管理页

新增 `FilesPage.tsx`，路由 `/s/:slug/files`。

UI：
- 顶部工具栏：上传按钮、搜索框
- 列表展示（暂不做树形，扁平 + 路径列；可后续迭代）
- 每行：路径、大小、mtime、操作（下载 / 重命名 / 删除）
- 重命名用 inline modal，复用现有 dialog 组件风格
- 删除二次确认

## 侧边栏调整

`Sidebar.tsx` 底部按钮重排：

```
搜索 → 文件管理 → Git 管理 → 回收站 → 设置
```

新增 "文件管理" 按钮（图标 `FolderOpen` 或 `Files`），路由 toggle 行为与回收站/git 管理一致（在当前页时点击返回 space 根）。

## 实施步骤

1. 后端：新建 `FilesHandler` + 路由 + `_files/` 路径校验工具
2. 后端：`PageService` 增加 `maintainFileContentBlocks`（保存）和 `enrichFileContentBlocks`（加载）
3. 前端：`api/files.ts` 封装所有文件 API
4. 前端：`FileContentBlock.tsx`（block spec + 组件渲染 + MD 转换）
5. 前端：`FilePickerMenu.tsx`（两 tab 选择菜单）
6. 前端：`FilesPage.tsx`（管理界面）
7. 前端：`Sidebar.tsx` 重排 + 新按钮 + App.tsx 路由

## 测试 / 验证

- 后端：`go build ./...`
- 前端：`npm run build`（或 dev 启动）
- 手工验证：
  - 在 space 中创建 `_files/test.txt`，页面里插入 fileContent block 选择它
  - 编辑内容保存，磁盘上 `_files/test.txt` 同步更新
  - 外部修改 `_files/test.txt`，刷新页面看到新内容
  - 上传同名文件触发冲突提示
  - 文件管理页删除文件后，引用它的 block 显示 "文件不存在"

## 未列入范围（YAGNI）

- 实时协同编辑（多人同时改同一文件）：当前模型保存时整体覆盖
- WebSocket 监听外部修改：靠刷新页面触发重载
- 文件版本历史：依赖现有 git 管理（如启用）
- 文件搜索/全文索引：当前只是按文件名过滤
