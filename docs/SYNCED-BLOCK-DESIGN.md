# 同步块（Synced Block）功能设计

## 1. 功能概述

实现 Notion 风格的同步块：在 A 页面定义一块内容，在 B、C、D... 页面引用此块；任一处编辑都会同步到所有引用位置。

### 触发方式（两种）

**A 方案 - 跨页粘贴自动触发**：
1. 用户在 Page A 选中若干连续 block，Cmd+C
2. 切到 Page B，Cmd+V
3. 弹对话框「检测到来自其他页面的内容，要创建为同步块吗？」
   - 选项 1：**创建为同步块（多端同步）** —— Page A 选中的块被包成"源块"，Page B 创建"镜像块"
   - 选项 2：**普通粘贴** —— 直接插入副本，与 Page A 互不影响

**C 方案 - slash menu 手动创建**：
- 在 slash menu 里加两个入口
  - **同步块（源）**：插入一个空的源块容器
  - **同步块（引用）**：插入一个镜像块，提示用户填写 sourcePageId + sourceBlockId

### 不应污染外部粘贴

复制同步块内容到外部应用（如记事本、其他 IDE）时，粘贴出的应当是干净的 markdown，**不能带任何 sync metadata 或 XML 标记**。

---

## 2. 存储设计（基于 markdown 文件，不引入数据库表）

### 源块（Source）

```markdown
<sync-block id="SOURCE_BLOCK_ID">
  <quoted>
    <q page-id="PAGE_B_ID" sync-id="MIRROR_BLOCK_ID_B" />
    <q page-id="PAGE_C_ID" sync-id="MIRROR_BLOCK_ID_C" />
  </quoted>
  <content>
此处是源块的真实 markdown 内容
可以是任意多个普通 block
  </content>
</sync-block>
```

- `id`：源块的全局唯一 ID（前端生成的 UUID）
- `<quoted>`：维护所有引用此源块的镜像块列表，每条含 `page-id`（镜像所在页面）和 `sync-id`（镜像自身的 ID）
- `<content>`：源块的真实内容（普通 markdown）

### 镜像块（Mirror）

```markdown
<sync-block id="MIRROR_BLOCK_ID" source-page="SOURCE_PAGE_ID" source-block="SOURCE_BLOCK_ID" />
```

- 自闭合标签，**自身不存储内容**
- 内容通过 API 从源块加载

### 为什么这样设计

- 复用项目已有的 `<sub-page>` / `<content>` XML 嵌入 markdown 模式
- 镜像块不冗余存储内容，源块更新后所有镜像自动反映
- 引用列表（`<quoted>`）维护在源块本地，便于级联删除

---

## 3. 同步模型（参照现有 fileContent 块的设计）

镜像块**不存储内容**，加载/写入流程：

1. **加载（Mirror Block 渲染时）**：
   - 镜像块从 markdown 解析出 `source-page` 和 `source-block`
   - 调用 `GET /spaces/{slug}/synced-block?sourcePageId=X&sourceBlockId=Y`
   - 后端读源页面 markdown，定位到对应 `<sync-block>`，抽出 `<content>` 内容返回
   - 前端把 markdown 转 BlockNote blocks，在嵌套 BlockNoteView 里渲染

2. **编辑（用户在镜像里改内容时）**：
   - 嵌套 BlockNoteView 的 onChange debounce 1.2s 后触发
   - 调用 `PUT /spaces/{slug}/synced-block/{sourceBlockId}?sourcePageId=X`
   - body 里带新的 markdown
   - 后端写回源页面 markdown 的 `<content>` 区域，保留 frontmatter
   - 同时若 body 带 `addQuoted`，把当前页面 + syncId 追加到 `<quoted>` 列表（如果还没在列表里）

3. **删除（用户删除源块时）**：
   - 拦截 Backspace/Delete 键（在 BlockNote 默认删除前）
   - 弹删除对话框，提供 3 种策略（见第 5 节）

---

## 4. API 设计

### GET /spaces/{slug}/synced-block

查询源块内容。

**Query**：`sourcePageId`, `sourceBlockId`

**Response**:
```json
{
  "markdown": "源块 <content> 内的 markdown 字符串",
  "sourceTitle": "源页面标题（用于 UI 展示）",
  "quoted": [
    { "pageId": "...", "syncId": "..." }
  ]
}
```

- 404：源块不存在（已被删除）→ 前端镜像显示"源已消失"占位

### PUT /spaces/{slug}/synced-block/{sourceBlockId}

反向写回源块内容。

**Query**：`sourcePageId`

**Body**:
```json
{
  "markdown": "新的 markdown 内容",
  "addQuoted": [{ "pageId": "...", "syncId": "..." }],
  "removeQuoted": ["syncId1", "syncId2"]
}
```

后端流程：
1. 读源页面 markdown
2. 定位到 `id="sourceBlockId"` 的 `<sync-block>`
3. 替换 `<content>` 内的 markdown
4. 若有 `addQuoted`，追加到 `<quoted>` 列表（去重）
5. 若有 `removeQuoted`，从 `<quoted>` 移除
6. 写回源页面文件（保留 frontmatter）
7. 调 `MarkGitDirty()` 标记 git 脏状态

### POST /spaces/{slug}/synced-block/wrap-source

把指定 markdown 子串包装成源块。**用于 A 方案粘贴对话框选"创建为同步块"时**——需要在源页面（Page A）找到刚被复制的内容，包上 `<sync-block>` 标签。

**Body**:
```json
{
  "sourcePageId": "Page A 的 id",
  "sourceMd": "被复制的 markdown 子串",
  "newSyncId": "前端生成的源块 UUID",
  "mirrorPageId": "Page B 的 id",
  "mirrorSyncId": "前端生成的镜像块 UUID"
}
```

**Response**:
```json
{
  "sourcePageId": "...",
  "sourceBlockId": "..."
}
```

后端流程：
1. 读 Page A markdown
2. 在 markdown 里搜索 `sourceMd` 子串
3. 找到后用 `<sync-block id="newSyncId"><quoted>...</quoted><content>sourceMd</content></sync-block>` 包起来（`<quoted>` 里初始放 mirror 引用）
4. 找不到 → 409 Conflict
5. 写回 Page A 文件

### DELETE /spaces/{slug}/synced-block/{sourceBlockId}

删除源块，可指定级联策略。

**Query**：`sourcePageId`

**Body**:
```json
{ "strategy": "cascade" | "placeholder" | "inline" }
```

**Response**:
```json
{
  "affectedPages": [{ "pageId": "...", "syncId": "..." }]
}
```

---

## 5. 删除策略（用户删源块时弹对话框）

当源块被 `<quoted>` 引用时，弹对话框让用户选：

### Strategy: cascade（推荐）

**级联删除所有镜像**：
- 遍历 `<quoted>` 列表
- 对每个引用页面：读 markdown，找到 `id="quoted.syncId"` 的镜像标签，删除
- 删除源块本身

### Strategy: placeholder

**只删源，镜像变"源已消失"占位**：
- 仅删除源块
- 镜像块下次 GET 时返回 404
- 前端镜像组件显示「同步块 · 源已消失」+ 重试按钮

### Strategy: inline

**内容直接插入到所有镜像位置**：
- 把源块 `<content>` 的 markdown 取出
- 对每个镜像：用这段 markdown 替换镜像标签（断开同步关系，转为普通 block）
- 删除源块本身

无引用时（`<quoted>` 为空）：直接删源块本体，不弹对话框。

---

## 6. 前端架构

### 6.1 BlockNote 自定义 block

两个自定义 block spec（`createReactBlockSpec`）：

#### syncedBlockSource（源块容器）
- `propSchema`: `{ syncId: { default: '' } }`
- `content: 'none'`（容器型，children 由 BlockNote 自动管理）
- `meta: { isolating: true }`
- 渲染：蓝色边框框住 children，顶部 label 显示「同步块（源）· syncId前8位 · 被 N 处引用」
- 引用列表 hover 显示，点击可跳转到引用页面

#### syncedBlockMirror（镜像块）
- `propSchema`: `{ syncId, sourcePageId, sourceBlockId }`
- `content: 'none'`
- `meta: { isolating: true }`
- 渲染流程：
  1. loading 状态：显示 spinner
  2. GET 源块内容 → markdownToBlocks → 创建独立 BlockNoteEditor 实例 → 嵌套 BlockNoteViewRaw 渲染
  3. live 状态：用户可编辑，onChange debounce 1.2s 后 PUT 反向写回
  4. broken 状态：源已消失（GET 返回 404），显示占位
  5. error 状态：加载失败，显示重试按钮
- `suppressChangeRef` 防止 replaceBlocks 时触发 onChange 死循环

### 6.2 状态指示

- **dirty / saving / saved** 显示在镜像 label：`未保存…` → `已同步`
- 顶部「跳转到源页面」按钮

### 6.3 跨页面粘贴触发流程（A 方案）

**这是整个功能最棘手的部分，需要特别注意**：

#### 问题背景

BlockNote 的 `editor.getSelection()` 内部对 NodeSelection 直接 return undefined：
```js
// BlockNote 源码
if (e.selection.empty || "node" in e.selection) return;
```
而 block handle 点击/shift+click 选中整块时，ProseMirror 创建的就是 NodeSelection。

更棘手的是：BlockNote 的 ⋮⋮ 拖拽手柄、slash menu、formatting toolbar 都通过 React Portal 渲染到 editor container DOM 树之外。点击这些 portal 元素后焦点跑掉，编辑器 PM selection 可能被清空。

#### 实测发现的难点

1. **复制事件不可靠**：在某些 focus 状态下（如关闭 ⋮⋮ 菜单后焦点跑到 body），Cmd+C 根本不派发 copy 事件
2. **PM selection 与 DOM 选区脱节**：焦点离开 contenteditable 后，PM state 可能空，但 DOM 选区还在
3. **BlockNote onSelectionChange 过滤器**：BlockNote 的 `onSelectionChange` 内部用 `Xt(transaction)` 过滤掉拖选产生的 selectionUpdate，所以订阅它拿不到拖选状态

#### 推荐的实现思路

**复制端**（关键挑战）：

1. 用 `editor._tiptapEditor.on('selectionUpdate', cb)` 订阅（绕过 BlockNote 的过滤层），把每次非空选中的 block IDs 缓存到 module-level 变量
2. Cmd+C 时（用 keydown 拦截，capture 阶段），从多个数据源依次尝试：
   - PM `state.selection`（编辑器有焦点时）
   - `window.getSelection()` + `posAtDOM` 转换（焦点丢失但 DOM 选区还在）
   - BlockNote `editor.getSelection()` 兜底
   - 第 1 步的缓存（焦点丢失、PM state 清空时）
3. 任一数据源拿到 N 个 block IDs 且不含 sync source/mirror → 设置 module-level `pendingSyncPaste` 变量
4. **不用 clipboardData 自定义 MIME**（BlockNote 的 navigator.clipboard.write 会覆盖；且会污染外部粘贴）

**粘贴端**：

1. 编辑器 container 上 capture 阶段监听 paste 事件
2. 检查 module-level `pendingSyncPaste` 是否存在 + 是否过期（5 分钟）
3. 检查当前 pageId 是否 ≠ sourcePageId（同页走默认粘贴）
4. 跨页则 `preventDefault` + `stopPropagation`，弹"创建同步块？"对话框

#### 用户选择对话框（SyncedBlockPasteDialog）

- 显示 sourceMd 前 200 字符预览
- 两个按钮：
  - **创建为同步块**：调 wrap-source API → Page A 出现源块、Page B 创建镜像
  - **普通粘贴**：直接用 sourceMd 转 blocks 插入

#### 删除对话框（SyncedBlockDeleteDialog）

- 显示引用数
- 三个按钮（cascade / placeholder / inline）
- 无引用时不弹对话框，直接删

### 6.4 Slash menu 入口

```ts
// 在 slash menu 加两项
{ title: '同步块（源）', onItemClick: () => editor.insertBlocks([{ type: 'syncedBlockSource', props: { syncId: uuid() } }], ...)}
{ title: '同步块（引用）', onItemClick: () => editor.insertBlocks([{ type: 'syncedBlockMirror', props: { syncId: uuid(), sourcePageId: '', sourceBlockId: '' } }], ...)}
```

### 6.5 Markdown 序列化（`frontend/src/utils/markdown.ts`）

需要加 parser 和 serializer：

**Parser**（识别两种 sync-block 标签）：
- `<sync-block id="..."><quoted>...</quoted><content>...</content></sync-block>` → `syncedBlockSource` block
- `<sync-block id="..." source-page="..." source-block="..." />` → `syncedBlockMirror` block

**Serializer**：
- `syncedBlockSource` → 输出含 quoted 和 content 的完整标签
- `syncedBlockMirror` → 输出 self-closing 标签

### 6.6 删除拦截

在 PageEditor 的 handleKeyDown 里，检测当前光标所在 block 是 syncedBlockSource 时，拦截 Backspace/Delete：
- 如果有引用（先 GET 查询），弹删除对话框
- 无引用，让 BlockNote 默认删除

---

## 7. 后端实现要点

### 7.1 handler 文件结构

`backend/internal/handler/synced_block_handler.go`，4 个 endpoint：Get / Update / WrapSource / Delete

### 7.2 关键 helper 函数

- `extractSyncedBlockContent(markdown, blockId)`: 在源 page markdown 里定位到指定 id 的 `<sync-block>`，抽出 `<content>` 内容和 `<quoted>` 列表
- `mutateSourceBlock(pagePath, blockId, mutateFn)`: 读源 page、定位 sync-block、调用 mutateFn 修改、写回（保留 frontmatter）
- `updateQuotedList(currentQuoted, add, remove)`: 维护 quoted 列表的增删

### 7.3 路由注册

`backend/cmd/server/main.go`：
```go
r.Get("/spaces/{slug}/synced-block", syncHandler.Get)
r.Put("/spaces/{slug}/synced-block/{sourceBlockId}", syncHandler.Update)
r.Post("/spaces/{slug}/synced-block/wrap-source", syncHandler.WrapSource)
r.Delete("/spaces/{slug}/synced-block/{sourceBlockId}", syncHandler.Delete)
```

### 7.4 PageService 改动

`MarkGitDirty()` 需要从 private 升为 public（或加 public alias），供 handler 调用。

---

## 8. 测试场景

1. **A 方案基本流程**：
   - Page A 选中 N 个 block，Cmd+C
   - Page B 粘贴 → 选"创建为同步块"
   - Page A 出现源块蓝框 + 「被 1 处引用」
   - Page B 出现镜像块 + 显示源内容
   - 在 Page B 编辑镜像 → debounce 后 Page A 的源块内容更新

2. **删除 - cascade**：
   - 在 Page A 删除源块 → 弹对话框
   - 选 cascade → Page B 的镜像块也消失

3. **删除 - placeholder**：
   - 选 placeholder → Page B 镜像显示「源已消失」

4. **删除 - inline**：
   - 选 inline → Page B 镜像位置变成普通 block（源块的内容副本）

5. **C 方案**：
   - slash menu 创建源块 → 在源块内添加内容
   - slash menu 创建镜像块 → 提示填写 source 信息

6. **不污染外部粘贴**：
   - 复制 sync 块内容到记事本 → 看到干净的 markdown（无 XML 标签）

---

## 9. 实现时要注意的坑

1. **BlockNote 0.50 的 React 包用 `BlockNoteViewRaw`**（不是 `BlockNoteView`）
2. **嵌套 BlockNoteView 共享 schema**：`BlockNoteEditor.create({ schema: outerEditor.schema, initialContent: blocks })`
3. **onChange 死循环**：replaceBlocks 时设 `suppressChangeRef.current = true`，下一帧再设回 false
4. **`meta: { isolating: true }`**：防止 sync 块内部的内容被外部 block 操作误吃
5. **`content: 'none'`**：source 是容器型，children 由 BlockNote 自动管理；mirror 不存内容
6. **跨页面导航保留 JS 状态**：SPA 内导航不会清空 module-level 变量，所以 `pendingSyncPaste` 跨页面有效
7. **`onSelectionChange` 不可靠**：必须直接订阅 TipTap 的 `selectionUpdate` 事件
8. **不要用 clipboardData 自定义 MIME**：BlockNote 的异步 Clipboard API 会覆盖
9. **Cmd+C 在某些 focus 状态下不派发 copy 事件**：用 keydown 拦截更可靠

---

## 10. 涉及的文件

### 前端
- `frontend/src/components/Editor/SyncedBlock.tsx` — 两个自定义 block spec
- `frontend/src/components/Editor/SyncedBlockPasteDialog.tsx` — 粘贴对话框
- `frontend/src/components/Editor/SyncedBlockDeleteDialog.tsx` — 删除对话框
- `frontend/src/api/syncedBlocks.ts` — API 客户端
- `frontend/src/components/Editor/PageEditor.tsx` — 注册 schema、slash menu、复制粘贴 hook、删除拦截
- `frontend/src/utils/markdown.ts` — parser / serializer

### 后端
- `backend/internal/handler/synced_block_handler.go` — 4 个 endpoint
- `backend/cmd/server/main.go` — 路由
- `backend/internal/service/page_service.go` — `MarkGitDirty` public alias
