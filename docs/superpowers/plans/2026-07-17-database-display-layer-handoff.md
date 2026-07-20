# 数据库展示层接手上下文

> 写给后续新开 agent 的交接文档。当前阶段的重点已经从“源数据库管理 / 定义编辑”转到“页面内数据库展示层”。接手前请先阅读原始设计文档：`docs/superpowers/specs/2026-07-15-database-feature-design.md`。

## 当前结论

源数据库管理这一块先认为基本完成，后续不要继续扩大改动范围。接下来主要处理展示层，也就是页面里的数据库块、视图配置、表格数据编辑、不同视图呈现，以及这些视图和数据源之间的关系。

关于 `relation`：暂时不调整。虽然用户提出过“关联可能更像展示层功能”，但目前结论是先维持原设计：`relation` 仍作为数据源 schema 能力存在，双向关联 / 反向 linked 的完整设计之后再单独细化。展示层开发时不要主动迁移或重构 relation 存储模型。

关于 `formula`：已从“视图私有列”收束为“数据源 schema 字段”。公式表达式保存在数据源 `config.json` 的 `columns[].config.formula` 中；公式结果只在展示层读取行数据后动态计算，不写入 `data.csv`。页面内 view 只通过 `property=<formula_col_id>` 控制公式字段的显示、隐藏、顺序和列宽，不再保存 `formula=` rule，也不再提供视图层公式列入口。

关于字段显示名：已取消 view 层显示名。字段名只来自数据源 schema，view 的 `<column><rule>` 不再保存 `as=`，旧 markdown 中的 `as=` 解析时忽略、重新保存时丢弃。后续不要重新引入“显示层自定义列名/映射列”的入口。

## 已完成的源数据库管理能力

主要页面是 `frontend/src/pages/DatabaseDetailPage.tsx`。

已经做过的关键调整：

- `Schema` 在界面上改为中文“定义”。
- 数据源删除放在数据库管理详情页右上角，点击垃圾桶后弹确认框，必须输入数据源名称验证后才能删除。
- 定义页支持可视化 / 源码模式切换，但默认优先展示可视化定义。
- 左侧字段列表不展示 UUID，宽度已收窄。
- 字段创建改为点击后在右侧编辑区创建，不再保留左侧“新字段名称 + 类型”的输入行。
- 右侧字段编辑区取消独立 footer，保存采用变更后自动保存或现有保存机制；删除 / 创建确认按钮在右上角。
- 所有字段的默认值配置已从定义界面去掉，默认值后续应放到展示层或数据录入体验里处理。
- 字段说明已去掉。
- 字段名称、类型、部分基础配置在一行内紧凑展示。

字段类型配置现状：

- 文本：支持最大长度。
- 密文：作为类型选项出现，底层按 `text + config.secret` 保存；密文类型不配置默认值。
- 数字：支持正负限制、小数位数、单位、范围；“显示格式”已去掉。
- 公式：作为数据源字段类型出现，表达式存在字段配置中；结果显示时动态计算，不落 CSV。
- 单选 / 多选 / 状态：选项配置已经重做为中文、紧凑、可视化样式。
- 单选 / 多选：新建选项默认形状为“无”。
- 状态：按“主分组 -> 分组内状态”管理。

选项配置现状：

- 每个选项独立配置形状：无、圆角、胶囊。
- 每个选项独立配置颜色、颜色模式、图标。
- 形状为“无”时禁用背景模式选择，只显示文本和图标。
- 颜色选择是自定义 dropdown，不用系统 select。
- 图标选择是展开 panel 样式，只显示图标，不显示文字。
- 图标宽度要求一致；当前已有实心圆、圆环、方形、三角形、六边形、加载、太阳、月亮、男、女、小孩、手机、雨伞等。
- 选项和状态分组都支持拖拽排序，使用受控的上下移动方式，避免原生拖拽影子和布局跳动。

## 已触碰的展示层现状

主要文件：

- `frontend/src/components/Editor/database/DatabaseRenderer.tsx`
- `frontend/src/components/Editor/database/database.css`
- `frontend/src/components/Editor/DatabaseBlock.tsx`
- `frontend/src/components/Editor/database/viewConfig.ts`

当前展示层已经有基础能力：

- 表格、看板、画廊、列表、日历、时间线的基础渲染。
- 表格单元格可编辑。
- 单选 / 多选 / 状态在表格里已经从系统 select 改为自定义 dropdown。
- dropdown 使用 portal 挂到 `document.body`，避免被表格 overflow 裁切。
- dropdown 会展示定义层配置的标签样式、图标、颜色。
- 状态 dropdown 会按状态主分组分组展示。
- 表格顶部原来的 `akdb-toolbar` 已去掉，避免重复显示标题和顶部“新增”按钮。
- 表格新增行入口已改到底部整行 `+ 新增`。
- 表格行删除按钮列已收窄并靠右。

当前展示层仍然比较粗糙，接下来应作为主要工作对象。

## 用户偏好和设计方向

用户明确偏好：

- 整体接近 Notion，但不要机械照抄。
- 界面要干净、紧凑，不要层级过多。
- Database 内所有菜单 / dropdown / popup 必须遵守原始规格 §9.7 的统一菜单规范：统一字号、行高、圆角、hover、图标颜色和默认类型图标，不要在单个组件里重新硬编码一套样式。
- 不要系统原生 select，因为展示不出自定义样式。
- dropdown / panel 这类浮层必须注意层级，不要被表格裁切。
- 交互变化不能导致布局抖动。
- 不要在 UI 上展示技术性 UUID。
- 默认值不要放在源数据库定义里，后续应考虑放到展示 / 录入层处理。
- 关联功能暂时不要继续设计，之后单独处理。

## 接下来展示层建议优先级

1. 表格视图继续打磨
   - 表头、列宽、单元格高度、底部新增行对齐。
   - 单选 / 多选 / 状态 dropdown 的细节继续向 Notion 靠齐。
   - 空值状态、hover、focus、键盘确认等编辑体验。
   - 行删除是否需要确认，按用户后续要求处理。

2. 视图配置能力
   - 现在 `viewConfig.ts` 只支持基础解析：列规则、groupBy、cover、date、startDate、endDate、cardSize、limit。
   - 后续需要做页面内的视图配置 UI，而不是只依赖 markdown 标签。
   - 视图配置属于展示层，应该保存在数据库块所在页面的 markdown 里，不写入数据源 `config.json`。
   - 视图配置不定义字段类型和公式表达式；公式属于数据源字段，view 只引用字段。
   - 视图配置不定义字段显示名；字段名属于数据源 schema。

3. 多视图切换和视图管理
   - 页面内数据库块应支持多个 view。
   - 需要考虑新增视图、重命名视图、切换视图、删除视图、复制视图。
   - 这些操作应复用现有页面保存流程，而不是新增后端 view API。

4. 非表格视图完善
   - 看板：状态 / 单选分组、卡片字段展示、拖动改状态可后续做。
   - 画廊：封面字段、卡片大小、展示字段。
   - 列表：更接近 Notion 的紧凑行样式。
   - 日历 / 时间线：先保证基础可用和配置明确。

5. 数据录入体验
   - 默认值配置已从定义层移除，展示层后续需要设计“新增行时使用哪些默认值”。
   - 可以从视图上下文推导，例如看板某一列新增时自动带当前分组值。

## 不要做的事

- 不要现在重构 `relation` / `linked` 的存储模型。
- 不要把视图配置写进数据源 `config.json`。
- 不要把源数据库定义界面再次扩大改动，除非展示层工作发现明确阻塞。
- 不要使用原生 select 做选项、状态、多选的核心交互。
- 不要私自提交代码；只有用户明确要求提交时才提交。
- 不要用 `git checkout` 或 `git reset` 还原文件，避免误删用户或其他 agent 的修改。

## 当前重要文件索引

- 原始设计：`docs/superpowers/specs/2026-07-15-database-feature-design.md`
- 数据源管理页：`frontend/src/pages/DatabaseDetailPage.tsx`
- 页面数据库块：`frontend/src/components/Editor/DatabaseBlock.tsx`
- 展示层渲染：`frontend/src/components/Editor/database/DatabaseRenderer.tsx`
- 展示层样式：`frontend/src/components/Editor/database/database.css`
- 视图配置解析：`frontend/src/components/Editor/database/viewConfig.ts`
- 前端 API：`frontend/src/api/databases.ts`
- 后端模型：`backend/internal/model/database.go`
- 后端服务：`backend/internal/service/database_service.go`
- 后端 handler：`backend/internal/handler/database_handler.go`

## 验证方式

每次展示层修改后至少运行：

```bash
cd frontend
npm run build
```

当前已知构建警告包括：

- `spaceStore.ts` 同时被动态和静态导入导致的 Vite warning。
- 部分 chunk 过大的 warning。

这些 warning 当前不是本轮展示层工作的阻塞。
