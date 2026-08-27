# 历史系统设计

> 本文档为 AKMDLibrary 历史系统的实现规格。核心原则：历史内容不写入业务文档本体，而是落盘到相邻的 `_history/` 系统目录；页面、数据库、数据库行页面按各自的数据语义记录和恢复。

---

## 0. 总览

新增一个最多保留 30 个版本的历史系统，覆盖：

- 普通 `.md` 页面正文与 frontmatter。
- database 的 `config.json` 与 `data.csv`。
- database row subpage 的 `.md` 正文。

不覆盖：

- `_files/` 文件池里的文件内容。
- fileContent block 引用文件的内容历史。

fileContent 相关页面中保存的引用关系仍属于普通页面历史，例如 `<content file="_files/a.md" lang="markdown" />` 变更会随页面 `.md` 被记录。

### 设计原则

1. **不污染业务文件**：历史不写进当前 `.md` / `.csv` / `.json` 文件内部。
2. **文件优先**：历史快照仍然是可读文件，便于 git、Agent、外部工具理解。
3. **恢复是复制快照成为当前状态**：恢复不会删除恢复点之后的历史；恢复前必须先记录当前状态。
4. **界面按用户语义聚合**：页面历史界面里可以混合展示页面历史和嵌入 database 的历史；底层仍分开存储。
5. **database config/data 成对快照**：database 每个历史版本必须同时保存 `config.json` 与 `data.csv`，避免恢复后结构和数据错配。

---

## 1. 存储结构

### 1.1 普通页面

每个页面的历史存放在该页面所在目录的 `_history/` 下：

```text
<page-dir>/
├── page.md
└── _history/
    ├── page_<page-uuid>.json
    └── page_<page-uuid>/
        ├── 20260824T103012Z_a1b2c3.md
        └── 20260824T104501Z_d4e5f6.md
```

`page_<uuid>.json` 是索引：

```json
{
  "object_type": "page",
  "object_id": "page-uuid",
  "current_path": "Space/Folder/page.md",
  "max_versions": 30,
  "versions": [
    {
      "id": "20260824T103012Z_a1b2c3",
      "created_at": "2026-08-24T10:30:12Z",
      "operation": "update_content",
      "snapshot": "page_page-uuid/20260824T103012Z_a1b2c3.md",
      "hash": "sha256...",
      "size": 12345
    }
  ]
}
```

### 1.2 Database

每个 database 在自己的目录下维护单条 database 历史时间线：

```text
<space>/_database/<db-name>/
├── config.json
├── data.csv
├── subpages/
│   └── <row-uuid>.md
└── _history/
    ├── history.json
    ├── versions/
    │   └── 20260824T103012Z_a1b2c3/
    │       ├── config.json
    │       └── data.csv
    └── subpages/
        ├── <row-uuid>.json
        └── <row-uuid>/
            └── 20260824T103012Z_a1b2c3.md
```

`_history/history.json` 是 database 层索引：

```json
{
  "object_type": "database",
  "database_id": "db-uuid",
  "max_versions": 30,
  "versions": [
    {
      "id": "20260824T103012Z_a1b2c3",
      "created_at": "2026-08-24T10:30:12Z",
      "operation": "update_row",
      "snapshot_dir": "versions/20260824T103012Z_a1b2c3",
      "hash": {
        "config": "sha256...",
        "data": "sha256..."
      }
    }
  ]
}
```

每个 database 版本目录必须同时保存：

```text
config.json
data.csv
```

即使某次操作理论上只改了 config 或只改了 data，也保存两份快照，保证恢复时是同一时刻的完整 database 层状态。

### 1.3 Database Row Subpage

row subpage 历史放在 database 的 `_history/subpages/` 下：

```text
_history/subpages/
├── <row-uuid>.json
└── <row-uuid>/
    └── <version-id>.md
```

索引示例：

```json
{
  "object_type": "database_subpage",
  "row_id": "row-uuid",
  "database_id": "db-uuid",
  "max_versions": 30,
  "versions": [
    {
      "id": "20260824T103012Z_a1b2c3",
      "created_at": "2026-08-24T10:30:12Z",
      "operation": "update_subpage",
      "snapshot": "<row-uuid>/20260824T103012Z_a1b2c3.md",
      "hash": "sha256...",
      "size": 12345
    }
  ]
}
```

---

## 2. 系统目录规则

`_history` 是系统目录，必须被所有普通内容扫描忽略：

- 页面树扫描忽略。
- 搜索索引忽略。
- 最近访问忽略。
- 导入/迁移扫描忽略。
- database row subpage 扫描忽略。

`_history` 不应出现在用户页面树中。

默认建议把 `_history` 纳入 git，让历史快照本身也能被外部备份和 Agent 读取。是否忽略 `_history` 可作为后续空间级设置，不属于 V1。

---

## 3. 版本记录规则

### 3.1 通用规则

写入业务文件前记录旧内容：

1. 读取当前文件。
2. 计算 hash。
3. 若和最新历史版本 hash 相同，不新增版本。
4. 若不同，写入快照文件。
5. 更新索引 JSON。
6. 裁剪超过 30 个版本的旧快照。
7. 再执行原业务写入。

版本 id 格式：

```text
YYYYMMDDTHHMMSSZ_<short-random>
```

示例：

```text
20260824T103012Z_a1b2c3
```

### 3.2 普通页面记录入口

需要记录页面历史的写入：

- `PageService.Update`：页面正文保存。
- `PageService.UpdateMeta`：标题、icon、cover、locked、starred、frontmatter 等变化。
- `insertSubpageInParent`：父页面新增 subpage block。
- `removeSubpageFromParent`：父页面移除 subpage block。
- 页面删除前可以记录最后版本，但回收站仍是删除恢复的主机制。

不记录：

- 首次创建页面。
- `ensurePageUUID` 自动补 id。
- 缓存修复、迁移 marker 等系统维护写入。

### 3.3 Database 记录入口

database 历史是一个整体版本。以下操作写入前必须记录当前 `config.json` 和 `data.csv` 的成对快照：

- `UpdateMeta`
- `AddColumn`
- `UpdateColumn`
- `DeleteColumn`
- `ReorderColumns`
- `CreateRow`
- `UpdateRow`
- `DeleteRow`
- `ReorderRows`
- `restoreRowValues`
- relation / linked 自动重建导致的数据变化

不记录：

- 首次创建 database。
- 初始化空 `data.csv`。
- 纯读取。

### 3.4 Row Subpage 记录入口

需要记录 row subpage 历史：

- `PutRowPage` 写入前。
- `DeleteRow` 删除 row subpage 前，如果 subpage 已创建。
- database 历史恢复覆盖某个 row subpage 前。

不记录：

- `GetRowPage` 首次懒创建空 subpage。

---

## 4. `_subpage_created` 隐藏列

database row subpage 是懒创建的：row 存在不代表 `subpages/<row>.md` 一定存在。为了历史恢复能准确还原“该时刻 subpage 是否存在”，`data.csv` 增加隐藏系统列：

```text
_subpage_created
```

规则：

- 该列不写入 `config.json.columns`。
- 前端不展示、不允许编辑。
- 后端读写 CSV 时作为内部字段处理。
- `CreateRow` 默认写入 `_subpage_created=false`。
- `GetRowPage` 首次创建 subpage 成功后，把该 row 改为 `_subpage_created=true`。
- `PutRowPage` 写入成功后，确保该 row 是 `_subpage_created=true`。
- `DeleteRow` 根据该字段判断是否需要打包/记录 row subpage。
- 恢复 database data 时，根据目标 CSV 的 `_subpage_created` 决定 row subpage 是否应该存在。

CSV 示例：

```csv
uuid,_subpage_created,title,created_time,last_edited_time,last_edited_user
row-1,true,已有正文,1787558400,1787558400,alice
row-2,false,从未打开过正文页,1787558400,1787558400,alice
```

---

## 5. 恢复语义

### 5.1 通用恢复

恢复不是删除历史后的回退，而是把历史快照复制成当前状态：

```text
v1 -> v2 -> v3 当前
```

恢复 `v1` 后：

```text
v1 -> v2 -> v3 -> v4 当前
```

其中 `v4` 内容等于 `v1`。恢复前必须先记录当前状态，防止误恢复后无法回到恢复前。

### 5.2 普通页面恢复

恢复页面版本时：

1. 记录当前页面为新历史版本，operation 为 `before_restore`。
2. 读取目标页面快照。
3. 覆盖当前页面文件。
4. 更新页面缓存 / repo 元数据。
5. 标记 git dirty。

如果页面内嵌 database，是否同时恢复相关 database 由前端恢复确认项决定。

### 5.3 Database 恢复

恢复 database 某个版本时：

1. 记录当前 database 的 `config.json` + `data.csv` 为新历史版本，operation 为 `before_restore`。
2. 读取目标版本目录里的 `config.json` 和 `data.csv`。
3. 覆盖当前 `config.json` 与 `data.csv`。
4. 解析目标 `data.csv`，同步 `subpages/` 目录。
5. 重建 linked / relation 派生数据。
6. 标记 git dirty。

database 恢复必须以目标 `data.csv` 为 row 存续来源。

### 5.4 Database 恢复时同步 subpages

恢复 database 版本时，目标 CSV 中的 row 集合称为 `targetRows`，当前 `subpages/` 中存在的 row 文件称为 `currentSubpages`。

对每个目标 row：

- 如果 `_subpage_created=true`：
  - 在 `_history/subpages/<row-uuid>/` 中寻找目标 database 版本时间点之前最近的一份 subpage 快照。
  - 找到则覆盖到 `subpages/<row-uuid>.md`。
  - 找不到则创建最小 frontmatter 壳文件。
- 如果 `_subpage_created=false`：
  - 确保 `subpages/<row-uuid>.md` 不存在。
  - 如果当前存在，直接删除。

对当前存在但目标 CSV 不包含的 row subpage：

- 直接删除 `subpages/<row-uuid>.md`。
- 不进入 `.trash`。
- 不因此清理它的 subpage 历史。

原因：database 历史恢复是快照覆盖，不是用户执行删除；恢复前已经记录当前状态，误恢复可通过历史再恢复回来。

### 5.5 Row Subpage 单独恢复

row subpage 可以单独恢复：

1. 仅当当前 `data.csv` 仍包含该 row，才允许恢复对应 subpage。
2. 恢复前记录当前 subpage 历史。
3. 用目标 subpage 快照覆盖当前 `subpages/<row-uuid>.md`。
4. 确保 `data.csv` 中该 row 的 `_subpage_created=true`。

如果 row 已不在当前 CSV 中，用户应先恢复 database 到包含该 row 的版本，再恢复 row subpage。

---

## 6. 历史裁剪与 GC

### 6.1 页面历史裁剪

每个页面最多保留 30 个版本。新增版本后，删除最旧的超额快照，并更新 `page_<uuid>.json`。

### 6.2 Database 历史裁剪

每个 database 最多保留 30 个 database 版本。新增版本后，删除最旧的超额版本目录，并更新 `_history/history.json`。

每次 database 历史裁剪后，必须运行 row subpage history GC。

### 6.3 Row Subpage 历史裁剪

每个 row subpage 自身最多保留 30 个快照，但删除条件还必须受 CSV 引用约束。

### 6.4 Row Subpage History GC

`subpage_<row-uuid>` 历史能否删除，不看当前 `subpages/<row>.md` 是否存在，只看是否仍被 CSV 引用：

- 当前 `data.csv` 是否包含该 row uuid。
- 保留中的 30 份 database `data.csv` 历史快照是否包含该 row uuid。

如果当前 CSV 和所有保留的 database data 快照都不包含该 row uuid，则该 row subpage 历史可以删除：

```text
_history/subpages/<row-uuid>.json
_history/subpages/<row-uuid>/
```

如果任一保留 CSV 仍包含该 row uuid，则必须保留该 row subpage 历史，即使当前 `subpages/<row>.md` 已不存在。

---

## 7. 回收站语义

历史恢复和回收站恢复是两套不同语义。

### 7.1 删除 row

当前 row 删除逻辑保持基本不变：

- 删除前把 row 的属性数据和已创建的 subpage 正文打包成一个 `.trash` 中的 md。
- 从 `data.csv` 删除该 row。
- 删除 `subpages/<row-uuid>.md`。
- 如果有子目录，也移动到 `.trash` 对应目录。

删除前还需要记录 database 历史；如果 subpage 已创建，也记录 row subpage 历史。

### 7.2 从回收站恢复 row

从 `.trash` 恢复 database row 不再原样占用旧 uuid，而是复制成新记录：

1. 生成新的 row uuid。
2. 用 trash package 中的 `row_values` 插入新 row。
3. 用 trash package 中的正文创建 `subpages/<new-row-uuid>.md`。
4. frontmatter 中的 `id`、`db` 等字段改成新 row / 当前 db。
5. 设置 `_subpage_created`。
6. relation / linked 重新计算。

这样回收站恢复是“把删除内容复制成新 row”，历史恢复则是“恢复到历史时刻的旧 uuid 状态”，两者不会冲突。

---

## 8. 前端交互

### 8.1 入口

页面右上角 `...` 菜单增加：

```text
历史记录
```

点击后打开全屏遮罩窗口。

### 8.2 历史窗口布局

```text
┌──────────────────────────────────────────────┬──────────────┐
│ 左侧：历史预览区                              │ 右侧：时间线 │
│                                              │              │
│ 展示点击时间点下这个页面应该看到的样子         │ 按时间倒序   │
│ 只读，不落盘                                  │ 页面历史     │
│                                              │ 数据库历史   │
│ 顶部或底部提供「恢复」按钮                     │ 混合排列     │
└──────────────────────────────────────────────┴──────────────┘
```

左侧是只读预览，点击右侧时间线只切换预览，不写入文件。点击“恢复”才调用 restore API。

### 8.3 页面历史时间线聚合

打开某个页面的历史窗口时：

1. 读取页面自身历史。
2. 解析页面当前 markdown 中的 database block。
3. 从 database block 的 `<view ... source="db-id">` 中提取嵌入的 database id。
4. 读取这些 database 的历史。
5. 将页面历史和嵌入 database 历史混合，按时间倒序排列。

用户看到的是“页面展示内容的变化时间线”，而不是底层文件列表。

### 8.4 预览语义

预览以选中的时间线 entry 的 `created_at` 作为时间点。

如果点击页面历史：

- 页面 markdown 使用该页面历史版本。
- 页面中嵌入的 database 使用该时间点之前最近的 database 历史版本。
- 如果没有 database 历史版本，可使用当前 database 数据，并在 UI 上标记“当前数据”。

如果点击 database 历史：

- 页面 markdown 使用该时间点之前最近的页面历史版本；没有则使用当前页面。
- 该 database 使用选中的 database 历史版本。
- 页面中其他 database 使用该时间点之前最近的 database 历史版本。

### 8.5 恢复确认

如果选中的是页面历史：

- 默认恢复页面本身。
- 如果页面中包含 database，确认窗口提供：

```text
同时恢复页面中的数据库
```

勾选后，后端按该时间点恢复页面中嵌入的 database。

如果选中的是 database 历史：

- 只恢复该 database 到该时间点。
- 页面 markdown 不变。

恢复成功后刷新当前页面、database block 数据、历史时间线。

---

## 9. 后端 API

### 9.1 页面历史

```http
GET /api/spaces/{slug}/pages/{pageId}/history/timeline
GET /api/spaces/{slug}/pages/{pageId}/history/preview?entry_id=...
POST /api/spaces/{slug}/pages/{pageId}/history/restore
```

`timeline` 返回页面历史与嵌入 database 历史的混合列表。

`preview` 返回左侧预览所需的页面 markdown 和 database 快照数据。

`restore` 执行恢复。

### 9.2 Database 历史

可供 database 独立页面复用：

```http
GET /api/spaces/{slug}/databases/{dbId}/history
GET /api/spaces/{slug}/databases/{dbId}/history/{versionId}/preview
POST /api/spaces/{slug}/databases/{dbId}/history/{versionId}/restore
```

### 9.3 Row Subpage 历史

```http
GET /api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page/history
GET /api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page/history/{versionId}
POST /api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page/history/{versionId}/restore
```

---

## 10. 实施步骤

1. 后端：新增 `HistoryService`，封装快照写入、索引更新、裁剪、hash、版本 id。
2. 后端：扫描器排除 `_history`。
3. 后端：PageService 写入点接入页面历史。
4. 后端：DatabaseService 写入点接入 database 成对快照。
5. 后端：为 `data.csv` 增加 `_subpage_created` 内部列处理。
6. 后端：DatabaseService 接入 row subpage 历史。
7. 后端：实现 database 历史恢复时的 subpages 同步规则。
8. 后端：调整回收站恢复 database row 为复制成新 uuid。
9. 后端：实现页面历史 timeline / preview / restore API。
10. 前端：新增 history API 封装。
11. 前端：页面右上角菜单增加“历史记录”。
12. 前端：实现历史遮罩窗口、右侧混合时间线、左侧只读预览。
13. 前端：database block 支持使用 preview API 返回的快照数据渲染。
14. 前端：实现恢复确认和恢复后刷新。

---

## 11. 验证场景

### 普通页面

- 编辑页面正文，确认生成页面历史。
- 修改标题/封面/收藏，确认生成页面历史。
- 恢复旧页面版本后，未来版本仍可再次恢复。

### fileContent

- 修改 fileContent 引用关系，确认页面历史记录变化。
- 修改 `_files/*` 文件内容，确认不生成历史。
- `_files` 下不创建 `_history`。

### Database

- 新增/删除/修改列，确认 database 历史生成，且每个版本同时有 `config.json` 和 `data.csv`。
- 新增/删除/修改 row，确认 database 历史生成。
- 恢复 database 旧版本，确认 config/data 一起恢复。
- 恢复 database 后，目标 CSV 没有的 subpage 被直接删除，不进回收站。

### Row Subpage

- 首次打开 row page 创建 subpage，不生成 subpage 历史，但 `_subpage_created=true`。
- 编辑 row page 后生成 subpage 历史。
- 恢复 database 到 `_subpage_created=false` 的版本，确认 subpage 文件不存在。
- 恢复 database 到 `_subpage_created=true` 的版本，确认 subpage 内容来自该时间点最近快照。

### 回收站

- 删除 database row，确认进入 `.trash`。
- 从 `.trash` 恢复 row，确认生成新 uuid。
- 恢复后的 row 不与历史系统中的旧 uuid 冲突。

### 裁剪

- 页面超过 30 个版本，确认旧快照被删除。
- database 超过 30 个版本，确认旧版本目录被删除。
- database history 裁剪后，确认不再被当前/保留 CSV 引用的 row subpage 历史被 GC。

---

## 12. 不列入 V1

- `_files` 文件内容历史。
- fileContent 引用文件历史。
- block 级历史。
- diff 合并。
- 多人协作冲突解决。
- 历史版本全文搜索。
- 历史与 git commit 的双向映射。
