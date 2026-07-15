# Notion 风格数据库（Database）功能设计

> 本文档为完整实现规格。**所有架构决策均已定稿**，接手实现的 agent 应严格按本文档执行；如发现遗漏或矛盾，先与维护者对齐再动手。

---

## 0. 总览

为 AKMDLibrary 增加 Notion 风格的"数据库"功能：用户可以在任意页面里嵌入一个数据库块，绑定（或新建）一个数据源，定义视图（表格 / 看板 / 画廊 / 列表 / 日历 / 时间线），并对数据做筛选、排序、公式计算、关联等操作。

### 设计哲学

1. **数据/展示分离**
   - 数据（CSV）= 行的原始属性值
   - 定义（config.json）= schema、列类型、枚举、约束
   - 呈现（视图）= 嵌在普通 MD 页面里的 HTML 风格标签块
   - 正文（subpages）= 行的页面正文
2. **文件优先**：所有内容都是文件，对 git 友好、对 LLM 友好、可被外部编辑器直接编辑
3. **完整复刻 Notion 体验**：6 种视图 + 关联 + 公式 + 系统字段

### 范围

V1 包含：
- 6 种视图：`table` / `board` / `gallery` / `list` / `calendar` / `timeline`
- 属性类型：`text` / `number` / `select` / `multi_select` / `date` / `checkbox` / `url` / `status` / `relation`
- 系统字段：`created_time` / `last_edited_time` / `last_edited_user` / `linked`（反向关联）
- 视图级公式（自定义 DSL）
- 两阶段过滤流水线（源过滤 + 显示过滤）
- 单向存储 + 系统维护反向 `linked` 列的关联机制
- 两个管理入口（页面内块 + 侧边栏「源数据管理」页）
- space 级权限

V1 不做（明确推迟）：
- `rollup`（汇总）
- `person`（人员）类型
- `files`（附件）类型
- 数据库模板（database template）
- 跨 space 关联
- 数据库单独的细粒度权限
- schema 层公式属性类型（采用视图级公式替代）
- 公式 DSL 的高级特性（正则、聚合窗口、嵌套自定义函数等）

---

## 1. 存储架构

### 1.1 目录布局

每个 space 根目录下新增 `_database/` 目录，每个数据源是一个子目录：

```
<docsRoot>/<space-name>/_database/<db_name>/
├── config.json              # 数据源定义（schema）
├── data.csv                 # 行数据（每行 UUID 标识）
└── subpages/
    └── <row_uuid>.md        # 该行对应的页面正文（懒创建）
```

约束：
- `<db_name>` 是用户可读的数据源名字（如 `读书笔记`），同时也是目录名；不允许包含 `/` `\` `:` `*` `?` `"` `<` `>` `|` 等文件系统保留字符；不允许以 `.` 开头
- `_database` 目录本身在 `pkg/filesystem/scanner.go` 的扫描忽略规则里需要新增一条：名字为 `_database` 不作为 page 处理（与现有 `_assets` / `_files` 同等待遇）
- `subpages/` 下的 `.md` 文件**不出现在文档树中**（文档树只看 space 根目录及同名文件夹规则），仅通过数据库视图/行页面访问

### 1.2 文件级并发

- 沿用现有 `pageLocks`（`sync.Map` + per-key `*sync.Mutex`）模式，新增 **per-database 锁表**
- 锁键：`<space-slug>/<db_name>` 全局唯一
- 跨数据库操作（如改 `relation` 同步 `linked`）必须**按数据库名字典序**依次加锁，避免死锁
- 自关联（同库 `relation → 自身`）只需一把锁

### 1.3 UUID 规则

- 数据库创建时生成 UUID（写入 config.json 的 `id` 字段）
- 每行新增时由后端生成 UUID v4，作为 `data.csv` 的 `uuid` 列
- 列定义中每�� column 也有自己的 `id`（UUID v4），与 column 名字解耦（方便改名）
- `linked` 列的 `id` 固定为 `_linked_from_<src_db_id>`，`<src_db_id>` 是源数据库的 UUID

---

## 2. config.json 格式

`config.json` 是数据源的 schema 文件。**LLM 友好、可外部编辑、被前端 / 后端 / git 共同维护**。

### 2.1 顶层结构

```json
{
  "id": "db-uuid-v4",
  "name": "读书笔记",
  "icon": "📖",
  "description": "可选的数据源描述",
  "created_at": "2026-07-15T10:00:00Z",
  "columns": [
    { "...单个列定义..." },
    { "...单个列定义..." }
  ]
}
```

字段：
- `id`：数据源 UUID，创建时生成，**不可变**
- `name`：数据源显示名，可改（改后是否同步改目录名？见 §2.5）
- `icon`：emoji 或图片 URL，可空
- `description`：可选描述
- `created_at`：ISO 8601
- `columns`：列定义数组，顺序即默认显示顺序

### 2.2 列定义通用字段

所有列都有：

```json
{
  "id": "col-uuid-v4",
  "name": "书名",
  "type": "text",
  "readonly": false,
  "auto": false,
  "default": null,
  "description": "可选",
  "config": { "...类型相关配置..." }
}
```

- `id`：列 UUID，**不可变**（CSV 列头用这个 id，不是 name）
- `name`：用户可改的显示名
- `type`：列类型，见 §2.3
- `readonly`：用户不可编辑（系统字段为 true）
- `auto`：系统自动维护（系统字段为 true）
- `default`：新增行时的默认值（类型相关；`auto` 列忽略此字段）
- `config`：类型相关配置

**重要：CSV 的列头使用 column.id，不是 name**。这样列改名不影响数据。LLM/外部编辑者需要通过 id 引用列。视图标签里 `property=` / `column=` 也使用 column.id。

### 2.3 各类型列的 `config`

#### text
```json
{ "type": "text", "config": {} }
```
CSV 存储：字符串（多行文本走 CSV 标准转义，用 `"..."` 包裹，内部双引号 `""` 转义）

#### number
```json
{ "type": "number", "config": { "precision": 2, "format": "decimal" } }
```
- `precision`：小数位数（-1 表示不限）
- `format`：`decimal` / `percent` / `currency`（V1 先实现 `decimal`）
CSV 存储：数字字符串（如 `"3.14"`）

#### select
```json
{
  "type": "select",
  "config": {
    "options": [
      { "id": "opt-uuid-1", "value": "未读", "color": "gray" },
      { "id": "opt-uuid-2", "value": "在读", "color": "blue" },
      { "id": "opt-uuid-3", "value": "已读", "color": "green" }
    ]
  }
}
```
CSV 存储：选中的 option id（如 `"opt-uuid-2"`），空字符串表示未选

#### multi_select
```json
{
  "type": "multi_select",
  "config": {
    "options": [
      { "id": "opt-uuid-1", "value": "技术", "color": "blue" },
      { "id": "opt-uuid-2", "value": "文学", "color": "purple" }
    ]
  }
}
```
CSV 存储：JSON 字符串 `["opt-uuid-1","opt-uuid-2"]`，空数组 `[]`

#### date
```json
{ "type": "date", "config": { "include_time": false } }
```
- `include_time`：是否包含时间
CSV 存储：ISO 8601 字符串（如 `"2026-07-15"` 或 `"2026-07-15T10:30:00Z"`）

#### checkbox
```json
{ "type": "checkbox", "config": {} }
```
CSV 存储：`"true"` / `"false"`

#### url
```json
{ "type": "url", "config": {} }
```
CSV 存储：字符串

#### status
```json
{
  "type": "status",
  "config": {
    "groups": [
      { "id": "grp-to-do", "name": "未开始", "option_ids": ["opt-uuid-1"] },
      { "id": "grp-in-progress", "name": "进行中", "option_ids": ["opt-uuid-2", "opt-uuid-3"] },
      { "id": "grp-complete", "name": "完成", "option_ids": ["opt-uuid-4"] }
    ],
    "options": [
      { "id": "opt-uuid-1", "value": "未开始", "color": "gray" },
      { "id": "opt-uuid-2", "value": "进行中", "color": "blue" },
      { "id": "opt-uuid-3", "value": "审核中", "color": "yellow" },
      { "id": "opt-uuid-4", "value": "已完成", "color": "green" }
    ]
  }
}
```
- `status` 是 `select` 的特化，额外有 `groups`（用于看板视图默认分组）
- CSV 存储同 select：option id

#### relation
```json
{
  "type": "relation",
  "config": {
    "target_db_id": "目标数据库 UUID",
    "target_db_name": "目标数据源名（冗余，便于展示，可能与实际不符时以 target_db_id 为准）",
    "multi": true
  }
}
```
- `target_db_id`：**只能指向同一 space 下的数据源**，跨 space 关联由后端拒绝
- `multi`：true 允许多选，false 单选
CSV 存储：JSON 字符串 `["row-uuid-1","row-uuid-2"]`（多选）或 `"row-uuid-1"`（单选）；空为 `[]` 或空字符串

#### created_time / last_edited_time（系统）
```json
{ "type": "created_time", "config": { "include_time": true }, "readonly": true, "auto": true }
```
CSV 存储：ISO 8601。**写入由后端在新增行 / 改行时自动填**，前端写入会被忽略

#### last_edited_user（系统）
```json
{ "type": "last_edited_user", "config": {}, "readonly": true, "auto": true }
```
CSV 存储：用户名（user.username）。后端在改行时自动更新

#### linked（系统，自动生成）
```json
{
  "id": "_linked_from_<src_db_id>",
  "name": "来自读书笔记",
  "type": "linked",
  "readonly": true,
  "auto": true,
  "config": {
    "src_db_id": "<源数据库 UUID>",
    "src_db_name": "读书笔记",
    "src_relation_col_id": "<触发本 linked 列的源 relation 列的 id，可多个>"
  }
}
```
CSV 存储：JSON 字符串
```json
[
  {"row_uuid": "<源行UUID>", "col_id": "<源 relation 列 id>"},
  {"row_uuid": "<另一个源行UUID>", "col_id": "<另一个源 relation 列 id>"}
]
```
- 同一源数据库的多个 relation 列共享一个 `linked` 列，靠 `col_id` 区分来源
- 此列**永远由系统维护**，前端写入会被后端拒绝/忽略

### 2.4 一个完整 config.json 示例

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "读书笔记",
  "icon": "📖",
  "description": "我的书单",
  "created_at": "2026-07-15T10:00:00Z",
  "columns": [
    { "id": "col-title", "name": "书名", "type": "text", "default": "" },
    { "id": "col-status", "name": "状态", "type": "status", "config": {
        "groups": [
          { "id": "g1", "name": "未开始", "option_ids": ["s1"] },
          { "id": "g2", "name": "进行中", "option_ids": ["s2"] },
          { "id": "g3", "name": "完成", "option_ids": ["s3"] }
        ],
        "options": [
          { "id": "s1", "value": "未读", "color": "gray" },
          { "id": "s2", "value": "在读", "color": "blue" },
          { "id": "s3", "value": "已读", "color": "green" }
        ]
      }
    },
    { "id": "col-tags", "name": "标签", "type": "multi_select", "config": {
        "options": [
          { "id": "t1", "value": "技术", "color": "blue" },
          { "id": "t2", "value": "管理", "color": "purple" }
        ]
      }
    },
    { "id": "col-author", "name": "作者", "type": "relation", "config": {
        "target_db_id": "authors-db-uuid",
        "target_db_name": "人物",
        "multi": false
      }
    },
    { "id": "col-price", "name": "单价", "type": "number", "config": { "precision": 2 } },
    { "id": "col-count", "name": "册数", "type": "number", "config": { "precision": 0 } },
    { "id": "col-created", "name": "创建时间", "type": "created_time", "readonly": true, "auto": true },
    { "id": "col-updated", "name": "修改时间", "type": "last_edited_time", "readonly": true, "auto": true },
    { "id": "col-updater", "name": "修改人", "type": "last_edited_user", "readonly": true, "auto": true }
  ]
}
```

被 `col-author` 关联的"人物"数据库，其 config.json 会**自动**多出一列：
```json
{
  "id": "_linked_from_550e8400-e29b-41d4-a716-446655440000",
  "name": "来自读书笔记",
  "type": "linked",
  "readonly": true,
  "auto": true,
  "config": {
    "src_db_id": "550e8400-e29b-41d4-a716-446655440000",
    "src_db_name": "读书笔记",
    "src_relation_col_id": "col-author"
  }
}
```

### 2.5 数据源重命名

数据源 `name` 改动**不同步改目录名**。目录名仅在创建时确定（用作 fs 路径），之后改 `name` 只影响显示。原因：
- 避免目录改名引发的所有引用（`<database src=>`）失效
- 数据库块的 `src=` 通过数据源 id 而不是 name 引用（见 §3.2）

⚠️ 实际操作：`<database>` 块的 `src=` 使用数据源 **id**（UUID），不是 name。LLM/外部编辑者需注意。

---

## 3. CSV 格式

### 3.1 总体规则

- 编码：UTF-8 with BOM（让 Excel 等正确识别）
- 分隔符：逗号
- 行结束符：`\n`
- 引号：`"`
- 转义：内部双引号写两次 `""`，多行字段必须用引号包裹
- 第一行是表头，使用 **column.id**（不是 name）
- 第一列固定为 `uuid`

### 3.2 表头顺序

```
uuid, <用户列按 config.columns 顺序>, <系统字段>, <linked 列>
```

系统字段（`created_time` / `last_edited_time` / `last_edited_user`）按其 column 在 config.columns 里的位置排列（即用户把它们放在哪就在哪）。

`linked` 列**始终追加在表头末尾**（即使用户在 config.json 里把它写在中间，CSV 序列化时也排到最后），方便读取。

### 3.3 数组与对象序列化

| 类型 | CSV 单元格内容 |
|---|---|
| `multi_select` | JSON 字符串 `["opt-id-1","opt-id-2"]` |
| `relation` (multi) | JSON 字符串 `["row-uuid-1","row-uuid-2"]` |
| `relation` (single) | 字符串 `row-uuid-1`（不加数组括号） |
| `linked` | JSON 字符串 `[{"row_uuid":"...","col_id":"..."}]` |
| 空 | 空字符串 |

### 3.4 一个完整 data.csv 示例

对应 §2.4 的 config.json：

```csv
uuid,col-title,col-status,col-tags,col-author,col-price,col-count,col-created,col-updated,col-updater,_linked_from_xxx-db-uuid
"book-uuid-1","深入理解计算机系统","s2","[\"t1\"]","person-uuid-1","129.00","1","2026-07-10T08:00:00Z","2026-07-15T09:30:00Z","alice","[]"
"book-uuid-2","人月神话","s3","[\"t1\",\"t2\"]","person-uuid-2","45.00","2","2026-06-01T10:00:00Z","2026-07-12T14:20:00Z","bob","[]"
```

### 3.5 CSV 读写注意事项

- 读：用 Go 标准库 `encoding/csv`；前端如需直接解析也用 papaparse 等成熟库
- 写：必须整文件重写（CSV 不支持局部修改）；写入前先获取 per-database 锁
- **跨数据库写**：用一致的加锁顺序（数据库名字典序），写完所有数据库后再统一释放
- 一致性恢复：写文件采用「先写临时文件 + rename」原子操作（`os.WriteFile` + `os.Rename`）

---

## 4. 视图嵌入：BlockNote 自定义块

数据库通过 **BlockNote 自定义块**嵌入到普通 MD 页面里。块序列化为 HTML 风格标签，可被 LLM/外部编辑器直接读写。

### 4.1 块定义

参考现有 `SyncedBlock.tsx` / `FileContentBlock.tsx` 实现，新增 `DatabaseBlock.tsx`：

```typescript
export const DatabaseBlockSpec = createReactBlockSpec(
  {
    type: "database",
    propSchema: {
      src: { default: "", values: "string" },        // 数据源 id（UUID）
      viewId: { default: "", values: "string" },     // 当前激活的视图 id
    },
    content: "none",  // 块本身不含内联内容
  },
  ...
);
```

实际视图配置（`<view>` 等子标签）作为块的"内部 markdown"存储，序列化时拼成 `<database>...</database>` 包裹。

### 4.2 序列化格式（HTML 风格）

完整标签层级：

```html
<database src="<db_uuid>" view="<active_view_id>">
  <view id="<view_uuid>" type="table" name="默认表格">
    <source-filter op="and">
      <rule property="<col_id>" op=">" value="18"/>
      <group op="or">
        <rule property="<col_id>" op="==" value="进行中"/>
        <rule property="<col_id>" op="==" value="已完成"/>
      </group>
    </source-filter>

    <column>
      <rule property="<col_id>" as="书名" width="200" hidden="false"/>
      <rule property="<col_id>" as="状态"/>
      <rule formula="prop(\"price\") * prop(\"count\")" as="总价"/>
    </column>

    <display-filter op="and">
      <rule column="<col_id_or_as>" op=">" value="100"/>
    </display-filter>

    <sort>
      <rule property="<col_id>" dir="desc"/>
      <rule column="<as>" dir="asc"/>
    </sort>

    <limit>50</limit>

    <!-- 视图类型相关配置 -->
    <group-by property="<col_id>"/>           <!-- board -->
    <cover property="<col_id>"/>              <!-- gallery -->
    <card-size>medium</card-size>             <!-- gallery: small/medium/large -->
    <date property="<col_id>"/>               <!-- calendar -->
    <start-date property="<col_id>"/>         <!-- timeline -->
    <end-date property="<col_id>"/>           <!-- timeline -->
  </view>

  <view id="<view_uuid2>" type="board" name="按状态">
    ...
  </view>
</database>
```

### 4.3 标签属性规范

| 标签 | 必填属性 | 可选属性 | 说明 |
|---|---|---|---|
| `<database>` | `src` | `view`（激活视图 id） | 数据库块根；`src` 是数据源 UUID |
| `<view>` | `id`, `type` | `name` | 一个视图定义；`type` ∈ `table`/`board`/`gallery`/`list`/`calendar`/`timeline` |
| `<source-filter>` | / | `op`（默认 `and`） | 顶层 group，子节点为 `<rule>` 或 `<group>` |
| `<display-filter>` | / | `op`（默认 `and`） | 同上，作用于显示列 |
| `<group>` | `op` | / | 子 group；V1 只允许一层，子节点只能是 `<rule>` |
| `<rule>`（filter 内） | `op`, `value` | `property`（source-filter 用）/ `column`（display-filter 用） | 二选一：`property=` 引用 schema 列 id；`column=` 引用 column 的 `as` 名 |
| `<column>` | / | / | 视图列定义容器 |
| `<rule>`（column 内） | / | `property`（绑定 schema 列）/ `formula`（公式）/ `as`（显示名，缺省时：`property=` 用 schema 列 name；`formula=` 必填否则报错）/ `width`（像素，默认 150）/ `hidden`（默认 false） | 视图里的一列 |
| `<sort>` | / | / | 排序容器 |
| `<rule>`（sort 内） | `dir` | `property` / `column` | 排序键，`dir` ∈ `asc`/`desc` |
| `<limit>` | 文本内容（数字） | / | 分页大小，0 表示不分页 |
| `<group-by>` | `property` | / | board 视图分组字段 |
| `<cover>` | `property` | / | gallery 视图封面字段（必须是 url 类型） |
| `<card-size>` | 文本内容 | / | `small`/`medium`/`large` |
| `<date>` | `property` | / | calendar 视图主日期字段 |
| `<start-date>` | `property` | / | timeline 视图开始日期字段 |
| `<end-date>` | `property` | / | timeline 视图结束日期字段 |

### 4.4 反序列化容错

LLM/外部编辑可能写出格式不完美的 HTML。规则：
- 未知标签：忽略（不报错）
- 缺失必填属性：跳过该规则/视图，日志告警
- `src` 不存在或为空：渲染"未绑定数据源"占位 UI（与新建块一致）
- `src` 指向不存在的数据源：渲染"数据源已丢失"提示，按钮可重新绑定
- 引用了不存在的 column id：该列隐藏，日志告警

### 4.5 视图类型默认配置

新建视图时各类型的默认配置：

| 视图类型 | 默认配置 |
|---|---|
| `table` | 所有非系统字段都显示，按 config.columns 顺���，列宽默认 150px |
| `board` | 提示用户选择 `group-by`（默认选第一个 status / select 列），卡片显示前 3 个属性 |
| `gallery` | 默认无封面，卡片大小 medium，卡片显示书名 + 第一个属性 |
| `list` | 列表项显示书名 + 前 2 个属性 |
| `calendar` | 提示用户选择 `date`（默认选第一个 date 类型列） |
| `timeline` | 提示用户选择 `start-date` 和 `end-date`（默认选前两个 date 列） |

---

## 5. 数据流水线

视图渲染时的处理顺序（前端为主，后端可承担部分）：

```
1. 读 CSV 全量行
2. [源数据过滤] source-filter（只能用 property= 引用 schema 列）
3. [列计算]
   - 对每个 column 规则：
     - property= → 直接取 schema 列的值
     - formula= → 用公式 DSL 求值（可访问所有 schema 列）
   - 得到"显示行"，每行带 {row_uuid, schema_props, display_cols}
4. [显示数据过滤] display-filter（只能用 column= 引用显示列 as 名）
5. [排序] sort（property= 或 column= 都行）
6. [limit] 分页
7. 渲染对应视图类型
```

性能要点：
- 源过滤可在后端做（API 接受 source-filter 参数，返回过滤后的行）
- 显示过滤必须前端做（先算公式）
- 排序默认前端做（除非源过滤后还要服务端排序）

---

## 6. 过滤运算符

### 6.1 按属性类型分

| 类型 | 运算符 |
|---|---|
| `text` / `url` | `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
| `number` | `==`, `!=`, `>`, `<`, `>=`, `<=`, `between`, `is_empty`, `is_not_empty` |
| `select` / `status` | `==`, `!=`, `in`（值是逗号分隔的多个 option id）, `not_in`, `is_empty`, `is_not_empty` |
| `multi_select` | `contains`（任一包含）, `not_contains`, `contains_all`（全包含）, `is_empty`, `is_not_empty` |
| `date` | `before`, `after`, `on`（同一天）, `within_relative`（"past_7_days" / "past_30_days" / "next_7_days" 等），`is_empty`, `is_not_empty` |
| `checkbox` | `is_checked`, `is_not_checked` |
| `relation` | `contains`（包含某 uuid）, `not_contains`, `is_empty`, `is_not_empty` |
| `created_time` / `last_edited_time` | 同 `date` |
| `last_edited_user` | `==`, `!=`, `in`, `not_in` |

### 6.2 group 与逻辑组合

- `<source-filter>` / `<display-filter>` 自身视为顶层 group，`op` 默认 `and`
- `<group>` 必须显式写 `op`
- V1 不允许 `<group>` 内嵌 `<group>`（YAGNI）

### 6.3 value 类型

`<rule ... value="...">` 的 value 总是字符串，按 property/column 类型解析：
- 数字：parseFloat
- 日期：ISO 8601
- select：option id（多个用逗号分隔，仅 `in` / `not_in`）
- checkbox：`"true"` / `"false"`
- 字符串：原样

---

## 7. 公式 DSL

公式出现在 `<column><rule formula="..." as="..."/></column>` 和 `<display-filter>` 中（display-filter 用 column= 引用公式列即可，无需在 filter rule 里写 formula）。

### 7.1 语法

类 Notion 风格表达式：

```
expression := or_expr
or_expr    := and_expr ( "or" and_expr )*
and_expr   := not_expr ( "and" not_expr )*
not_expr   := "not" not_expr | comparison
comparison := add_expr ( comp_op add_expr )?
comp_op    := "==" | "!=" | ">" | "<" | ">=" | "<="
add_expr   := mul_expr ( ("+" | "-") mul_expr )*
mul_expr   := unary ( ("*" | "/" | "%") unary )*
unary      := "-" unary | primary
primary    := number | string | boolean | "(" expression ")" | func_call | prop_access
prop_access:= "prop" "(" string ")"
func_call  := identifier "(" (expression ("," expression)*)? ")"
```

### 7.2 字面量

- 数字：`3.14`、`-1`、`100`
- 字符串：`"hello"`（双引号）
- 布尔：`true` / `false`
- null：`null`

### 7.3 内置函数（V1）

| 函数 | 说明 |
|---|---|
| `prop("name")` | 取当前行 schema 列的值（参数是 column.id 或 column.name 都可，先按 id 匹配，匹配不到再按 name） |
| `length(s)` | 字符串/数组长度 |
| `concat(a, b, ...)` | 字符串拼接 |
| `substr(s, start, len?)` | 子串 |
| `lower(s)` / `upper(s)` | 大小写转换 |
| `replace(s, pattern, replacement)` | 字符串替换（pattern 是普通字符串，非正则；V1 不做正则） |
| `contains(s, sub)` | 字符串包含 |
| `now()` | 当前时间（datetime） |
| `dateDiff(a, b, "days"\|"hours"\|"minutes")` | 时间差 |
| `dateAdd(d, n, "days"\|"hours"\|"minutes")` | 时间加减 |
| `year(d)` / `month(d)` / `day(d)` | 取日期部分 |
| `abs(n)` / `round(n)` / `floor(n)` / `ceil(n)` | 数学 |
| `max(...)` / `min(...)` | 最值 |
| `if(cond, a, b)` | 条件 |
| `coalesce(a, b, ...)` | 第一个非 null |
| `isEmpty(v)` | 是否为空（空字符串/null/空数组） |

### 7.4 类型系统

- 类型：`number` / `string` / `boolean` / `datetime` / `null` / `array`
- 自动类型转换：
  - number ↔ string：双向自动（`"3" + 1 == 4`，`"a" + 1 == "a1"`）
  - boolean → number：`true=1, false=0`
  - null 参与运算：`null + 1 == 1`，`null == null == true`，`null > x` 永远 false
- 类型不兼容（如 datetime + string）：返回 null + 日志告警

### 7.5 双端实现一致性

- 前端（TypeScript）：手写递归下降 parser + 求值器
- 后端（Go）：同样手写递归下降 parser + 求值器
- 两端必须用**同一份单元测试用例**保证语义一致。测试用例文件统一存放：
  - 源文件：`backend/testdata/formula_cases.json`（一份权威用例）
  - 前端通过构建脚本拷贝/符号链接到 `frontend/src/formula/formula_cases.json`，或者直接 fetch
  - 用例格式：`{ "expr": "...", "props": {...}, "expected": <value>, "desc": "..." }`

### 7.6 公式求值时机

- 任何列计算（步骤 3）时按需求值
- 不缓存（数据规模小，YAGNI）
- 公式语法错误：该列显示 `#ERROR`，日志告警，不影响其他列

---

## 8. 关联系统（relation）

### 8.1 存储模型

| 方向 | 存储位置 | 数据格式 |
|---|---|---|
| 正向（用户定义的 `relation` 列） | 源数据库 CSV | `[row-uuid1, row-uuid2]` 或 `row-uuid1` |
| 反向（系统维护的 `linked` 列） | 目标数据库 CSV | `[{row_uuid, col_id}, ...]` |

### 8.2 自动维护时机

| 触发操作 | 源 DB 改动 | 目标 DB 改动 |
|---|---|---|
| 用户新建正向关联（A 行的 relation 列加入 B 行 uuid） | A 的该行 relation 列追加 uuid | B 的对应行 `_linked_from_<A_id>` 列追加 `{A_row_uuid, relation_col_id}` |
| 用户移除正向关联 | A 的该行 relation 列移除 uuid | B 的对应行 `linked` 列移除该项 |
| 用户在 B 的 `linked` 列删除一项（UI 上） | 实际操作：去 A 的对应行的 relation 列移除 B 的 uuid | 然后 B 的 linked 列自然更新（系统重算） |
| 删除 A 的某行 | 该行从 CSV 移除 | 该行曾经关联的所有 B 行的 linked 列移除该 A uuid |
| 删除 B 的某行 | 所有引用过该 B 的 A 行的 relation 列移除 B uuid（从 B 的 linked 列直接拿到列表，O(1)） | 该行从 CSV 移除 |
| 在 A 的 schema 新增 `relation` 列指向 B | A 的 config.json 加列，A 的 data.csv 加空列 | B 的 config.json 自动加 `_linked_from_<A_id>` 列，B 的 data.csv 加空列 |
| 在 A 的 schema 删除 `relation` 列 | A 的 config.json 删列，A 的 data.csv 删列 | B 的 config.json 删对应 linked 列，B 的 data.csv 删列 |
| 删除整个 A 数据库 | / | 所有被 A 关联的 DB 都要清理 `_linked_from_<A_id>` 列 |

### 8.3 加锁规则

- 单库内操作：per-database 锁
- 跨库操作：按数据库名字典序依次加锁，全部加完后再开始写，全部写完后再统一释放
- 死锁防护：永远不允许反向加锁顺序

### 8.4 悬空引用处理

- 读到指向不存在行的 uuid：跳过（视为 null），日志告警
- 后台 GC 任务（可选）：定期扫描，清理悬空引用。V1 可不做，YAGNI

### 8.5 自关联

例如"任务"数据库的"前置任务"列指向自己：
- 任务表的 CSV 里 `前置任务` 列存 `[task-uuid1]`
- 任务表的 CSV 里同时有 `_linked_from_<任务_db_id>` 列，存反向引用
- ��锁是同一把 per-DB 锁，无死锁风险

---

## 9. 视图类型详细规范

### 9.1 table（表格）

- 行：显示数据过滤 + 排序 + 分页后的行
- 列：`<column>` 里非 `hidden` 的列，按顺序
- 单元格交互：
  - 双击进入编辑模式（控件按类型选择）
  - 失焦或回车提交（写 CSV）
  - select / status / multi_select：下拉多选框
  - date：日期选择器
  - checkbox：直接点击切换
  - relation：弹窗选择目标行
  - 公式列：只读
  - 系统字段：只读
- 表头：
  - "+" 按钮：新增列（弹窗配置类型）
  - 列名右键：编辑列 / 隐藏列 / 删除列
- 行头：
  - 行首 "+" 按钮：新增行
  - 行号右键：删除行 / 复制行 / 打开页面

### 9.2 board（看板）

- 按 `<group-by>` 字段（select 或 status）分组成多列
- 每列内：按 sort 排序的卡片列表
- 卡片显示：封面（若有 url 字段且配置）+ 标题（第一个 text 字段）+ 卡片字段
- 卡片交互：
  - 点击：打开行页面
  - 拖拽：跨列移动 = 改 `group-by` 字段值
  - 卡片右键：删除 / 复制
- 列头：
  - 列名（来自 select/status 的 option value）
  - "+" 按钮：在该列新增行（自动设置该列 option）
  - 列设置：折叠/展开、删除该列（删除 option 自动清理相关行）

### 9.3 gallery（画廊）

- 网格布局，卡片大小 `<card-size>`
- 每张卡片：封面（`<cover>` 字段的 url）+ 标题（第一个 text 字段）+ 几个属性
- 点击卡片打开行页面
- 右上角"配置"按钮：选择封面字段、卡片字段

### 9.4 list（列表）

- 一行一个 item，紧凑布局
- 每个 item：标题 + 几个关键属性
- 点击进入行页面
- table 的轻量版

### 9.5 calendar（日历）

- 月视图网格
- `<date>` 字段作为日期
- 同一天多个事件：堆叠显示，可滚动
- 点击日期：新增行（自动设置该日期）
- 点击事件：打开行页面
- 顶部切换月份

### 9.6 timeline（时间线）

- 甘特图风格
- `<start-date>` 和 `<end-date>` 字段
- 可选 `<group-by>` 分泳道
- 拖拽条目边缘调整起止日期
- 拖拽条目整体移动
- 顶部切换时间尺度（日/周/月）

---

## 10. 行页面（subpage）

### 10.1 懒创建

- 行首次创建时**不**生成 `subpages/<uuid>.md`
- 用户在表格点击行号"打开页面" / 看板卡片点击 / 在表格行展开（如有此交互）等触发时，后端创建空 md 文件并返回
- md 文件模板：
  ```markdown
  ---
  id: <row_uuid>
  title: "<自动取第一个 text 列值，无则 Untitled>"
  type: database-row
  db: <db_uuid>
  ---

  <!-- 这里是行正文 -->
  ```

### 10.2 行页面布局

- 顶部：行属性面板（所有列以表单形式展示，可编辑，提交时写 CSV）
- 下方：复用现有 `PageEditor` 编辑正文
- 面包屑：`<space> / <数据库显示名> / <行标题>`

### 10.3 行页面在文档树

- **不**在文档树中显示
- 仅通过数据库视图访问
- URL：`/s/<space>/db/<db_uuid>/row/<row_uuid>`

---

## 11. 管理入口

### 11.1 页面内数据库块（创建流程）

1. 用户在页面里输入 `/database` 或 `/table` 触发 slash 菜单 → 插入一个空数据库块
2. 块上显示两个 CTA 按钮：
   - 「**绑定已有数据源**」：弹窗列出当前 space 已有数据源（图标 + 名字 + 描述），用户点选
   - 「**创建新数据源**」：弹窗输入新数据源名（+ 可选图标 + 描述）→ 后端创建 `_database/<name>/` 目录 + 空 config.json + 空 data.csv → 块绑定
3. 绑定后，块内默认展示一个 `table` 视图，所有非系统字段都显示
4. 块顶部 tab 切换视图，"+" 新建视图（弹窗选类型）
5. 块内每个视图都能：
   - 拖拽列顺序（写回 `<column>` 的顺序）
   - 列宽调整（写回 width 属性）
   - 列右键：编辑列定义（写 config.json）/ 隐藏（写 hidden）/ 删除（写 config.json）
   - 视图右上角"..."菜单：编辑筛选 / 编辑排序 / 编辑视图配置 / 复制视图 / 删除视图

### 11.2 侧边栏「源数据管理」入口

在 `frontend/src/components/Layout/Sidebar.tsx` 中，于「引用文件库」和「回收站」之间插入一个按钮：

```tsx
<button
  onClick={() => {
    const path = `/s/${currentSpace?.slug}/databases`;
    navigate(location.pathname === path ? `/s/${currentSpace?.slug}` : path);
  }}
  disabled={!currentSpace}
  className={`... ${location.pathname === `/s/${currentSpace?.slug}/databases` ? 'bg-notion-hover' : ''}`}
  title="源数据管理"
>
  <Database className="w-[18px] h-[18px] text-[#91918e]" strokeWidth={1.7} />
  <span>源数据管理</span>
</button>
```

新增路由 `/s/:slug/databases` 和 `/s/:slug/databases/:dbId`：
- `/databases`：数据源列表（卡片视图，每张卡显示图标/名/描述/列数/行数），右上角"新建数据源"按钮
- `/databases/:dbId`：单个数据源详情，三个 tab：
  - **数据**：嵌入式 table 视图（始终显示所有列，无筛选），可直接增删改行
  - **Schema**：可视化编辑 config.json（增删列、改类型、改枚举值），高级用户可切换"源码模式"直接编辑 JSON
  - **关联**：展示本库的 relation 列和被其他库引用的 linked 列，可视化关系图

---

## 12. 权限

完全走 space 级权限，沿用现有 `Member` 模型（admin / writer / reader）：

| 角色 | 可读 | 可写 schema | 可写数据 | 可创建数据源 | 可删除数据源 |
|---|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| writer | ✅ | ✅ | ✅ | ✅ | ❌（仅 admin） |
| reader | ✅ | ❌ | ❌ | ❌ | ❌ |

- 后端在每个 database handler 检查 space 权限
- `reader` 在数据库块里看到的数据是只读的（UI 上隐藏"+"和编辑入口）
- 不引入数据库级别的细粒度共享

---

## 13. API 设计

所有 API 走现有 `/api/spaces/{slug}/...` 前缀。

### 13.1 数据源

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/spaces/{slug}/databases` | 列出 space 下所有数据源（轻量，不带 columns） |
| POST | `/api/spaces/{slug}/databases` | 新建数据源（body: name, icon, description） |
| GET | `/api/spaces/{slug}/databases/{dbId}` | 取数据源详情（带 columns） |
| PATCH | `/api/spaces/{slug}/databases/{dbId}` | 改数据源元信息（name, icon, description） |
| DELETE | `/api/spaces/{slug}/databases/{dbId}` | 删除数据源（连带删除 _database/<name> 整个目录；级联清理所有反向引用） |

### 13.2 Schema（列）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/spaces/{slug}/databases/{dbId}/columns` | 新增列（body: name, type, config, default） |
| PATCH | `/api/spaces/{slug}/databases/{dbId}/columns/{colId}` | 改列（可改 name / config / default；改 type 时需要数据迁移） |
| DELETE | `/api/spaces/{slug}/databases/{dbId}/columns/{colId}` | 删列（同步清理 CSV 该列 + 反向 linked） |
| POST | `/api/spaces/{slug}/databases/{dbId}/columns/reorder` | 调整列顺序（body: colId 数组） |

### 13.3 行（数据）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/spaces/{slug}/databases/{dbId}/rows` | 查询行（query: source-filter, sort, limit, offset, select 列）；返回行数组 |
| POST | `/api/spaces/{slug}/databases/{dbId}/rows` | 新建行（body: 部分列值；后端补 UUID + 系统字段；触发 linked 联动） |
| GET | `/api/spaces/{slug}/databases/{dbId}/rows/{rowId}` | 取单行 |
| PATCH | `/api/spaces/{slug}/databases/{dbId}/rows/{rowId}` | 改行部分字段（body: 改动字段）；更新 last_edited_*；触发 linked 联动 |
| DELETE | `/api/spaces/{slug}/databases/{dbId}/rows/{rowId}` | 删行（触发 linked 联动） |

### 13.4 行正文

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page` | 取行正文 md（懒创建：不存在则创建空模板并返回） |
| PUT | `/api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page` | 写行正文 md |

### 13.5 视图（前端本地存储）

视图配置存在数据库块所在的页面 md 文件里（即 `<database><view>...</view></database>` 标签），所以**视图 CRUD 走现有 page 编辑 API**，不需要单独的视图 API。前端编辑视图时直接更新块 props / 块内部 markdown，复用 PageEditor 的保存流程。

---

## 14. 后端实现要点

### 14.1 文件结构

新增：

```
backend/internal/
├── handler/
│   └── database_handler.go         # HTTP handlers
├── service/
│   ├── database_service.go         # 业务逻辑（CSV 读写、锁、关联联动）
│   └── formula/                    # 公式 DSL
│       ├── parser.go
│       ├── evaluator.go
│       └── evaluator_test.go
├── repository/                     # 无需新增（文件即数据，不走 SQLite）
└── model/
    ├── database.go                 # 数据结构
    └── formula.go

backend/pkg/
└── databasecsv/                    # CSV 读写工具（可独立测试）
    ├── reader.go
    ├── writer.go
    └── atomic.go                   # 临时文件 + rename
```

### 14.2 锁机制

在 `DatabaseService` 内：

```go
type DatabaseService struct {
    docsDir string
    mu      sync.RWMutex
    dbLocks sync.Map  // key: "<space-slug>/<db_name>" → *sync.Mutex
}

func (s *DatabaseService) lockDB(spaceSlug, dbName string) func() {
    key := spaceSlug + "/" + dbName
    v, _ := s.dbLocks.LoadOrStore(key, &sync.Mutex{})
    mu := v.(*sync.Mutex)
    mu.Lock()
    return func() { mu.Unlock() }
}

// 跨库操作：按字典序加锁
func (s *DatabaseService) lockDBs(keys []string) func() {
    sort.Strings(keys)
    var unlocks []func()
    for _, k := range keys {
        v, _ := s.dbLocks.LoadOrStore(k, &sync.Mutex{})
        v.(*sync.Mutex).Lock()
        unlocks = append(unlocks, func() { v.(*sync.Mutex).Unlock() })
    }
    return func() {
        for i := len(unlocks) - 1; i >= 0; i-- {
            unlocks[i]()
        }
    }
}
```

### 14.3 CSV 原子写

```go
func AtomicWriteCSV(path string, rows [][]string) error {
    tmp := path + ".tmp"
    f, err := os.Create(tmp)
    if err != nil { return err }
    w := csv.NewWriter(f)
    if err := w.WriteAll(rows); err != nil {
        f.Close()
        os.Remove(tmp)
        return err
    }
    w.Flush()
    f.Close()
    return os.Rename(tmp, path)
}
```

### 14.4 公式 DSL 实现

- 递归下降 parser（按 §7.1 文法）
- AST 节点：`Number / String / Bool / Null / Prop / Func / Unary / Binary`
- 求值器：传入 `rowProps map[string]interface{}`，递归求值
- 单元测试：维护 `testdata/formula_cases.json`，前后端共用

---

## 15. 前端实现要点

### 15.1 文件结构

新增：

```
frontend/src/
├── components/
│   ├── Editor/
│   │   ├── DatabaseBlock.tsx              # BlockNote 自定义块
│   │   ├── database/
│   │   │   ├── DatabaseBlockView.tsx      # 块主视图（tab 切换 + 块菜单）
│   │   │   ├── views/
│   │   │   │   ├── TableView.tsx
│   │   │   │   ├── BoardView.tsx
│   │   │   │   ├── GalleryView.tsx
│   │   │   │   ├── ListView.tsx
│   │   │   │   ├── CalendarView.tsx
│   │   │   │   └── TimelineView.tsx
│   │   │   ├── cells/
│   │   │   │   ├── TextCell.tsx
│   │   │   │   ├── NumberCell.tsx
│   │   │   │   ├── SelectCell.tsx
│   │   │   │   ├── DateCell.tsx
│   │   │   │   ├── CheckboxCell.tsx
│   │   │   │   ├── RelationCell.tsx
│   │   │   │   └── ... (每种类型一个)
│   │   │   ├── FilterEditor.tsx           # source/display filter 编辑器
│   │   │   ├── SortEditor.tsx
│   │   │   ├── ColumnEditor.tsx           # column rule 编辑器
│   │   │   ├── SchemaEditor.tsx           # 列定义编辑器（写 config.json）
│   │   │   ├── ViewSwitcher.tsx           # 视图 tab + 新建视图
│   │   │   └── DataSourcePicker.tsx       # 绑定/新建数据源弹窗
│   │   └── ... 现有
│   └── ...
├── pages/
│   ├── DatabasesPage.tsx                  # /s/:slug/databases
│   └── DatabaseDetailPage.tsx             # /s/:slug/databases/:dbId
├── formula/
│   ├── parser.ts
│   ├── evaluator.ts
│   └── evaluator.test.ts
├── stores/
│   └── databaseStore.ts                   # Zustand
└── api/
    └── databaseApi.ts
```

### 15.2 BlockNote 块注册

在 `BlockNoteComponents.tsx` 或 `PageEditor.tsx` 的 schema 里追加 `DatabaseBlockSpec`：

```typescript
import { DatabaseBlockSpec } from "./Editor/DatabaseBlock";

export const blockSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...existingCustomBlocks,
    database: DatabaseBlockSpec,
  },
});
```

### 15.3 序列化（HTML ↔ BlockNote）

参考 `SyncedBlock.tsx` 的实现：

- `parseFn`：从 markdown 字符串中识别 `<database ...>...</database>`，解析出 `src` / `view` / 子标签结构，构造块 props
- `render`：渲染 React 组件
- 块内部状态变化时（用户编辑视图配置），重新生成 HTML 写回块的 markdown

### 15.4 行页面路由

新增路由 `/s/:slug/db/:dbId/row/:rowId`：
- 顶部：属性面板（编辑属性 → PATCH 行）
- 下方：复用 `PageEditor`（保存 → PUT 行正文）

### 15.5 视图组件接口约定

所有视图组件统一 props：

```typescript
interface ViewComponentProps {
  dbId: string;
  schema: DatabaseSchema;             // config.json 解析
  rows: Row[];                        // 后端返回 + 前端公式求值后的行
  viewConfig: ViewConfig;             // <view> 解析
  onUpdateRow: (rowId: string, changes: Partial<Row>) => Promise<void>;
  onCreateRow: (defaults?: Partial<Row>) => Promise<void>;
  onDeleteRow: (rowId: string) => Promise<void>;
  onOpenRow: (rowId: string) => void;
  onEditSchema: () => void;           // 弹 schema 编辑器
  onEditViewConfig: () => void;       // 弹视图配置编辑器
}
```

### 15.6 性能注意

- 大数据量（>1000 行）时考虑虚拟滚动（react-window 或 tanstack-virtual）
- 公式求值结果可考虑 useMemo 缓存（按 rowId + 公式字符串作 key）

---

## 16. 错误处理与边界情况

### 16.1 数据损坏

- config.json 解析失败：API 返回 500，前端显示"数据源损坏，请联系管理员"，不破坏其他数据源
- data.csv 解析失败：同上
- 行 UUID 重复：日志告警，重复行都展示，由用户决定删除

### 16.2 悬空引用

- relation 指向不存在的行：显示"[已删除]"占位，可手动清理
- linked 列里的 row_uuid 指向不存在的行：跳过该项

### 16.3 列类型变更的数据迁移

用户改列类型时（如 `text` → `number`），需要决定如何处理已有数据：

| 旧 → 新 | 策略 |
|---|---|
| text → number | 尝试 parseFloat；失败则置空，日志记录 |
| number → text | 直接转字符串 |
| select → text | 取 option 的 value 作为字符串 |
| text → select | 字符串匹配 option；不匹配置空 |
| select → multi_select | 单值包成数组 |
| multi_select → select | 取第一个 |
| 任意 → checkbox | 非空非零为 true |
| date → text | ISO 字符串 |
| **不兼容变更**（如 relation → date） | 弹确认对话框："数据将被清空，确认？" |

### 16.4 CSV 转义

- 多行 text 字段：必须用 `"..."` 包裹，内部换行符原样
- 包含逗号 / 引号 / 换行：必须用 `"..."` 包裹
- 用 `encoding/csv` 自动处理

### 16.5 跨数据库写入失败

- 写 A 成功，写 B 失败：
  - 立即尝试回滚 A
  - 回滚失败（极少见）：日志严重告警，进入"数据不一致"状态
  - 启动时一致性检查任务（可选）：扫描所有 linked 列，对照正向 relation 校验，发现不一致则修复

---

## 17. 测试策略

### 17.1 后端

- 单元：
  - `databasecsv` 读写：构造各种边界（空表、多行、特殊字符、多行 text）
  - `formula` parser + evaluator：用 `testdata/formula_cases.json` 跑全部用例
  - `DatabaseService`：mock 文件系统，测 CRUD、关联联动、锁顺序
- 集成：起服务，跑完整 API 流程（建库 → 加列 → 加行 → 改行 → 删行 → 删库）
- 一致性：构造故意破坏的 CSV，测试启动恢复逻辑

### 17.2 前端

- 单元：
  - 公式 evaluator：与后端共用同一份 `formula_cases.json`
  - HTML ↔ 块序列化：构造各种 HTML 输入（合法 / 部分合法 / 不合法），验证解析与重新序列化稳定
- 组件：每个视图组件独立测渲染 + 主要交互（用 vitest + testing-library）
- E2E（可选）：playwright 跑建库 → 嵌入 → 改视图 → 关联的完整流程

---

## 18. 实施建议（给实现者）

### 18.1 推荐分阶段实施

虽然 V1 范围全部确定，但建议按以下顺序渐进实现，每阶段都能独立验证：

**阶段 1：基础设施**
1. 后端 `DatabaseService` 基础（CRUD 数据源、CRUD 列、CRUD 行）
2. CSV 读写工具 + 原子写
3. per-database 锁
4. config.json 解析与校验

**阶段 2：核心 UI**
5. 前端 `DatabaseBlock` 块（仅 table 视图）
6. HTML ↔ 块序列化
7. table 视图完整功能（增删改行/列、内联编辑）
8. 行页面（懒创建 + 属性面板 + PageEditor）

**阶段 3：公式与过滤**
9. 公式 DSL 前端 + 后端
10. source-filter / display-filter 后端查询
11. FilterEditor / SortEditor UI

**阶段 4：其他视图**
12. board 视图（带拖拽）
13. gallery 视图
14. list 视图
15. calendar 视图
16. timeline 视图

**阶段 5：关联系统**
17. relation 列 + linked 列自动维护
18. 关联 UI（relation 单元格、linked 列显示）
19. 级联删除

**阶段 6：管理入口**
20. 侧边栏「源数据管理」入口
21. DatabasesPage / DatabaseDetailPage
22. 列表 + Schema 编辑器 + 数据编辑器

**阶段 7：系统字段与收尾**
23. created_time / last_edited_time / last_edited_user
24. status 类型 + 看板分组
25. 权限校验
26. 边界情况与错误处理
27. 测试补齐

### 18.2 注意事项

- **CSV 的列头是 column.id，不是 name**——这是常见踩坑点
- **`<database src=>` 用数据源 UUID，不是名字**
- **跨库操作必须按数据库名字典序加锁**
- **任何写入 CSV 都走原子写（tmp + rename）**
- **维护 linked 列时，删除 B 要从 B 的 linked 列直接拿引用列表（O(1)），不要扫表**
- **公式 DSL 前后端必须用同一份测试用例保证语义一致**
- **新增的 `_database` 目录要在 `pkg/filesystem/scanner.go` 的忽略规则里加一条**

---

## 19. 术语表

| 术语 | 含义 |
|---|---|
| 数据源（data source） | `_database/<name>/` 目录下的一个完整数据库实体（config.json + data.csv + subpages） |
| 数据库块（database block） | 嵌入在普通页面里的 BlockNote 块，引用某个数据源 |
| 视图（view） | 一个数据库块内对数据源的一种呈现方式（table/board/gallery/list/calendar/timeline） |
| schema | 数据源的定义，即 config.json |
| 列（column） | schema 里的字段定义；CSV 里表头对应一列 |
| 行（row） | data.csv 里的一行，对应一个实体 |
| 行页面（row page） | 行对应的 md 文件 `subpages/<uuid>.md`，承载正文 |
| 正向关联（relation） | 用户定义的关联列，存在源数据库 |
| 反向关联（linked） | 系统自动维护的列，存在目标数据库 |
| 源过滤（source-filter） | 对 CSV 原始属性过滤 |
| 显示过滤（display-filter） | 对计算后的显示列过滤 |
| 公式（formula） | 视图级的列计算表达式 |

---

## 20. 附录：完整示例

### 20.1 一个简单的"读书笔记"数据库

**目录结构**

```
docs/
└── my-space/
    ├── 我的书单.md                    ← 嵌入了数据库块的页面
    └── _database/
        ├── 读书笔记/
        │   ├── config.json
        │   ├── data.csv
        │   └── subpages/
        │       ├── book-uuid-1.md
        │       └── book-uuid-2.md
        └── 作者/
            ├── config.json
            └── data.csv
```

**`我的书单.md`**

```markdown
---
id: page-uuid
title: 我的书单
---

# 我的书单

这里是我的阅读记录：

<database src="550e8400-e29b-41d4-a716-446655440000" view="v-default">
  <view id="v-default" type="table" name="全部">
    <column>
      <rule property="col-title" as="书名" width="240"/>
      <rule property="col-status" as="状态" width="100"/>
      <rule property="col-tags" as="标签"/>
      <rule property="col-author" as="作者"/>
      <rule formula="prop(\"col-price\") * prop(\"col-count\")" as="总价"/>
    </column>
    <sort>
      <rule property="col-created" dir="desc"/>
    </sort>
    <limit>50</limit>
  </view>

  <view id="v-board" type="board" name="按状态">
    <group-by property="col-status"/>
    <column>
      <rule property="col-title" as="书名"/>
      <rule property="col-tags" as="标签"/>
    </column>
  </view>

  <view id="v-gallery" type="gallery" name="封面墙">
    <cover property="col-cover"/>
    <card-size>medium</card-size>
    <column>
      <rule property="col-title" as="书名"/>
      <rule property="col-status" as="状态"/>
    </column>
  </view>
</database>
```

**`_database/读书笔记/data.csv`**

```csv
uuid,col-title,col-status,col-tags,col-author,col-price,col-count,col-cover,col-created,col-updated,col-updater,_linked_from_authors-db-uuid
"book-uuid-1","深入理解计算机系统","s2","[\"t1\"]","person-uuid-1","129.00","1","https://...","2026-07-10T08:00:00Z","2026-07-15T09:30:00Z","alice","[]"
"book-uuid-2","人月神话","s3","[\"t1\",\"t2\"]","person-uuid-2","45.00","2","https://...","2026-06-01T10:00:00Z","2026-07-12T14:20:00Z","bob","[]"
```

**`_database/作者/data.csv`**

```csv
uuid,col-name,_linked_from_550e8400-e29b-41d4-a716-446655440000
"person-uuid-1","Randal E. Bryant","[{\"row_uuid\":\"book-uuid-1\",\"col_id\":\"col-author\"}]"
"person-uuid-2","Frederick P. Brooks Jr.","[{\"row_uuid\":\"book-uuid-2\",\"col_id\":\"col-author\"}]"
```

打开"作者"数据库的"Randal E. Bryant"行，`linked` 列会显示 "📖 深入理解计算机系统"，点击跳转。

---

**本设计文档结束。**

实施过程中如发现文档未覆盖的情况，**优先与维护者对齐再实施**，不要凭直觉补充。所有架构决策都有明确理由，不要轻易推翻。
