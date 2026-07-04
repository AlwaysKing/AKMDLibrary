# AKMDLibrary 内容格式参考

本文件说明 AKMDLibrary 知识库**写入 MD 文件时支持的所有格式**：YAML frontmatter、标准 Markdown 块、本项目自定义的 HTML 标签（用于表达 BlockNote 编辑器中的高级块）、行内样式、媒体引用、文件路径约定。

面向对象：知识库内容创作者、外部编辑 MD 文件的工具与 Agent、把外部内容迁入本系统的导入脚本。

> 本文档描述的是 **MD 文件中实际持久化的语法**（编辑器保存后落盘的格式）。BlockNote 编辑器内部把这些语法解析为可视化块；外部直接编辑 MD 文件时也必须按本规范书写，否则下次打开页面会被错误解析。

---

## 目录

- [一、YAML Frontmatter（页面元数据）](#一yaml-frontmatter页面元数据)
- [二、段落与基础块](#二段落与基础块)
- [三、列表类块](#三列表类块)
- [四、引用 / 代码 / 分隔](#四引用--代码--分隔)
- [五、表格（`<table-block>`）](#五表格table-block)
- [六、折叠块（`<toggle-h>` / `<toggle-list>`）](#六折叠块toggle-h--toggle-list)
- [七、多列布局（`<column-list>`）](#七多列布局column-list)
- [八、标记 / 高亮（`<mark>`）](#八标记--高亮mark)
- [九、文件内容块（`<content />`）](#九文件内容块content-)
- [十、页面引用 / 子页面 / 书签](#十页面引用--子页面--书签)
- [十一、媒体块（图片 / 视频 / 音频 / 文件）](#十一媒体块图片--视频--音频--文件)
- [十二、行内格式](#十二行内格式)
- [十三、颜色调色板](#十三颜色调色板)
- [十四、文件与目录路径约定](#十四文件与目录路径约定)
- [十五、特殊语义说明](#十五特殊语义说明)

---

## 一、YAML Frontmatter（页面元数据）

每个页面 MD 文件**可选**地以 YAML frontmatter 开头，用 `---` 包裹。所有字段都是可选的；省略整个 frontmatter 也是合法的。

```markdown
---
id: f5effe5f25824fa784fdddf21243f08a
icon: "\U0001F308"
cover: https://images.unsplash.com/photo-xxx.jpg
icon_large: false
cover_offset: 100
full_page: false
locked: false
starred: true
---

正文从这里开始……
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (32 位 hex) | 页面 UUID，系统内部用于跨页面引用。新建页面时由后端生成，**不要手填**。 |
| `icon` | string | 页面图标。可以是 emoji（如 `"\U0001F308"` YAML 转义形式，或直接写 `🌈`）、`http(s)://` 图片 URL、或 `./_assets/...` 本地图标路径。 |
| `cover` | string | 封面图。可以是 `http(s)://` URL 或 `./_assets/...` 本地路径。 |
| `icon_large` | bool | 为 `true` 时图标以大尺寸渲染（页面顶部大图标模式）。 |
| `cover_offset` | int | 封面图的纵向偏移（像素），用于聚焦封面不同区域。 |
| `full_page` | bool | 为 `true` 时页面内容占满全宽（默认有最大宽度限制）。 |
| `locked` | bool | 为 `true` 时页面被锁定，仅管理员可编辑。 |
| `starred` | bool | 是否出现在收藏夹。 |

YAML 字段必须使用下划线命名（`full_page` 而非 `fullPage`）。空 frontmatter（所有字段为零值）会在保存时被后端自动省略。

---

## 二、段落与基础块

| 块类型 | 语法 | 示例 |
|--------|------|------|
| 段落 | 直接写文本 | `这是一个段落。` |
| 空段落 | 单独一行零宽空格 `​` (U+200B) | `​` |
| 标题 1–4 | `# ` 到 `#### ` | `## 二级标题` |
| 标题 5–6 | ❌ **不支持**（被禁用，保存时不会产出） | — |

注意：

- **空段落必须用零宽空格 `​` 占位**。直接留空行会被解析为段落分隔符（即"没有段落"），不是空段落。
- 标题级别只支持 1–4。从编辑器 slash 菜单插入时也只有 1–4。
- 标题文本支持行内格式（粗体、链接、`<span>` 等）。

---

## 三、列表类块

| 块类型 | 语法 | 示例 |
|--------|------|------|
| 无序列表 | `- ` 或 `* ` 开头 | `- 苹果`<br>`* 香蕉` |
| 有序列表 | `数字.` 开头（保存时统一写成 `1. `） | `1. 第一步` |
| 待办列表 | `- [ ] ` 或 `- [x] ` | `- [x] 已完成` |

注意：

- 有序列表保存时会**统一写为 `1. `**（Markdown 会自动递增显示），原文件里不会保留 `2. 3. 4.` 的具体数字。
- 列表项内容支持行内格式。
- 列表不支持嵌套缩进（用子页面 / 折叠块表达层级）。

---

## 四、引用 / 代码 / 分隔

### 引用

```markdown
> 这是一段引用
```

单行 `>` 开头即为引用块。多行连续引用每行都要带 `>`。

### 代码块

````
```javascript
function hello() {
  console.log('hi');
}
```
````

支持的围栏语言（保存时映射到 Shiki ID）：

| 输入别名 | 映射为 |
|---------|--------|
| `js` / `javascript` / `mjs` / `cjs` | `javascript` |
| `ts` / `typescript` / `tsx` | `typescript` |
| `jsx` | `jsx` |
| `py` / `python` | `python` |
| `rb` / `ruby` | `ruby` |
| `rs` / `rust` | `rust` |
| `go` / `golang` | `go` |
| `java` | `java` |
| `kt` / `kotlin` | `kotlin` |
| `swift` | `swift` |
| `c` / `h` | `c` |
| `cpp` / `cc` / `hpp` / `c++` | `cpp` |
| `cs` / `csharp` / `c#` | `csharp` |
| `php` | `php` |
| `sh` / `bash` / `shell` / `zsh` | `bash` |
| `ps1` / `powershell` | `powershell` |
| `sql` | `sql` |
| `json` | `json` |
| `yaml` / `yml` | `yaml` |
| `toml` | `toml` |
| `xml` / `html` / `svg` | `xml` / `html` / `svg` |
| `css` / `scss` / `less` | `css` / `scss` / `less` |
| `md` / `markdown` | `markdown` |
| `objc` / `objectivec` | `objective-c` |
| `dockerfile` | `docker` |
| `tex` | `latex` |
| 其他 | 原样保留为自定义语言 ID |

文件名启发式（`dockerfile` → `docker`、`makefile` → `make`）仅在文件内容块中适用，普通代码块以围栏语言为准。

### 分隔线

```markdown
---
```

或三个以上 `*` / `-` 连写。**注意**：`---` 紧贴段落时可能被识别为 frontmatter 边界；保留空行隔开能避免歧义。

---

## 五、表格（`<table-block>`）

普通 GFM pipe 表格**不支持**。所有表格必须用自定义 `<table-block>` 标签包裹，否则会被解析为普通段落。两种格式可混用：

### 格式 A：管道格式（无合并单元格）

```markdown
<table-block>
| 姓名 | 年龄 | 城市 |
| --- | --- | --- |
| 张三 | 28 | 北京 |
| 李四 | 35 | 上海 |
</table-block>
```

- 第一行：表头。
- 第二行：分隔行 `| --- | --- |`。
- 后续行：数据。

可选功能：

- **列宽**（像素）：写进分隔行，`| 120 | --- | 240 |` 表示第 1 列 120px、第 3 列 240px、中间列自适应。
- **单元格背景色**：写在单元格文本前，`{bg:blue}文本`。颜色名见 [第十三节](#十三颜色调色板)。
- **转义管道符**：单元格内的 `|` 写成 `\|`。

### 格式 B：JSON 格式（有合并单元格时使用）

```markdown
<table-block>
{
  "widths": [120, null, 240],
  "rows": [
    {
      "cells": [
        { "text": "标题1", "cs": 2, "rs": 1, "bg": "default" },
        { "text": "标题3", "cs": 1, "rs": 1, "bg": "default" }
      ]
    }
  ]
}
</table-block>
```

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `widths` | `(number \| null)[]` | 可选。每列像素宽度，`null` 表示自适应。 |
| `rows` | `Row[]` | 行数组。也可省略 `widths` 直接写 `[Row, Row, ...]`。 |
| `rows[].cells[].text` | string | 单元格文本（支持行内格式）。 |
| `rows[].cells[].cs` | number | colspan，默认 1。 |
| `rows[].cells[].rs` | number | rowspan，默认 1。 |
| `rows[].cells[].bg` | string | 单元格背景色，默认 `default`。 |

**触发 JSON 格式的条件**：表格中任一单元格 `colspan > 1` 或 `rowspan > 1`，保存时自动用 JSON。无合并时优先用管道格式（人类可读性更好）。

---

## 六、折叠块（`<toggle-h>` / `<toggle-list>`）

### 折叠标题 `<toggle-h>`

```markdown
<toggle-h level="2">
<title>标题文本</title>
<content>
子内容（任意块）
</content>
</toggle-h>
```

- `level` 取值 1–4，对应 H1–H4 级别的折叠标题。
- `<title>` 必填，支持行内格式。
- `<content>` 必填（可空），内部递归嵌套任意块。
- 支持嵌套：`<content>` 内可再放 `<toggle-h>`。

### 折叠列表项 `<toggle-list>`

```markdown
<toggle-list>
<title>列表项标题</title>
<content>
- 子项 1
- 子项 2
</content>
</toggle-list>
```

- 没有 level 属性。
- 其余规则同 `<toggle-h>`。

注意：标签必须**独占一行**（解析器按行匹配），如 `<toggle-h level="2">` 不能与下面的 `<title>` 写在同一行。

---

## 七、多列布局（`<column-list>`）

```markdown
<column-list ratios="50,50">
<column ratio="50">
左列内容（任意块）
</column>
<column ratio="50">
右列内容（任意块）
</column>
</column-list>
```

| 属性 | 位置 | 说明 |
|------|------|------|
| `ratios` | `<column-list>` | 逗号分隔的比例字符串（如 `"30,70"`、`"25,50,25"`）。整体省略时默认 `"50,50"`。 |
| `ratio` | `<column>` | 当前列的宽度比例（整数）。 |

规则：

- `<column-list>` 必须包裹所有 `<column>`，列数不限。
- 每列内部递归嵌套任意块（段落、列表、表格、折叠、嵌套列布局等都可）。
- 所有列都为空时，整块在保存时被自动省略。
- `<column>` 标签必须独占内容的边界（与 `<toggle-h>` 一样按行匹配）。

---

## 八、标记 / 高亮（`<mark>`）

类似 Notion 的 callout / 高亮块，渲染为带左边框和背景色的块。

```markdown
<mark color="blue">
这是一段蓝色高亮文本，可包含**粗体**等行内格式。
</mark>
```

```markdown
<mark>不带 color 属性时使用默认灰色样式</mark>
```

| 属性 | 取值 | 说明 |
|------|------|------|
| `color` | 颜色名（见 [十三](#十三颜色调色板)）或 `default` | 决定文字色、背景色、左边框色。省略时等同 `default`。 |

支持单行或跨行。跨行时开始标签和结束标签各占一行（或与文本同行也可，解析器支持两种）。

`<mark>` 内的内容是**行内**（inline），不能放块级元素；要做带块内容的高亮框，用 `<column-list>` 单列 + `<mark>`，或用表格单格 + 背景色。

---

## 九、文件内容块（`<content />`）

引用当前 space 下 `_files/` 目录里的文本文件，在页面中以代码块风格显示文件内容；用户在页面里编辑该块时，**保存页面会同步写回文件**。

### 自闭合形式（推荐）

```markdown
<content file="_files/config.json" lang="json" />
```

| 属性 | 说明 |
|------|------|
| `file` | 文件路径，必须以 `_files/` 开头，相对当前 space 目录。 |
| `lang` | 显示语言（围栏语言映射同代码块），默认 `text`。 |

### 配对形式（仅旧版兼容）

````markdown
<content file="_files/config.json" lang="json">
{
  "name": "demo"
}
</content>
````

配对形式中的**正文内容会被解析器丢弃**——文件实际内容总是从 `_files/` 实时读取。这是设计上的硬约束：MD 文件本身永远不存储文件正文，避免双向同步歧义。

规则：

- 路径必须在 `_files/` 下（防穿越）。
- 文件大小限制：上传 10MB；页面加载注入 1MB，超出则块显示"加载失败"。
- 修改块内容 → 保存页面 → 后端把新内容写回 `_files/<path>`。
- 外部用 SSH 等工具改了 `_files/` 下文件 → 下次打开页面天然反映最新内容。
- 在编辑器内"解除引用"后，块退化为普通代码块。

---

## 十、页面引用 / 子页面 / 书签

这三类块用类似的"自闭合标签 + data 属性"语法。**旧版 HTML 注释语法仍可读取**（向后兼容），但保存时统一写为新版标签形式。

### 页面引用 `<page-ref>`

```markdown
<page-ref data-id="f5effe5f25824fa784fdddf21243f08a"></page-ref>
```

- `data-id`：被引用页面的 32 位 hex UUID（即目标页面 frontmatter 的 `id` 字段）。
- 旧版：`<!-- pageref:f5effe5f25824fa784fdddf21243f08a -->`（可读取，保存时改写为新版）。
- 双击渲染后的页面引用块会跳转到目标页面。

### 子页面 `<sub-page>`

```markdown
<sub-page data-id="abc123..."></sub-page>
```

- `data-id`：子页面的 UUID。
- 旧版：`<!-- subpage:UUID -->`。
- 与"页面引用"的区别：子页面在编辑器内插入时会**自动创建一个新页面**（成为当前页面的子页面，文件实际落在父页面同名文件夹下），并自动填入 `data-id`；页面引用则是引用**已存在**的任意页面。
- 子页面的物理文件由后端 `maintainSubpageBlocks` 维护，**不要手编 frontmatter 的 `id` 来伪造子页面关系**。

### 书签 `<book-mark>`

```markdown
<book-mark data-url="https://example.com/article"></book-mark>
```

- `data-url`：外部 URL。
- 旧版：`<!-- bookmark:https://example.com/article -->`。
- 渲染时由后端抓取 og:title / og:description / og:image / favicon，以卡片形式显示。

注意：以上三种标签的 UUID 长度严格 32 位 hex；写错会按普通段落处理。

---

## 十一、媒体块（图片 / 视频 / 音频 / 文件）

每类媒体都支持新版自定义标签（推荐）和旧版 markdown fallback（仅用于读取兼容，保存时统一改写为新版）。

### 图片 `<image-block>`

```markdown
<image-block url="./_assets/abc/def/photo.png" caption="说明文字" width="600" align="center"></image-block>
```

| 属性 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | 图片地址。可以是 `http(s)://`、`./_assets/...`、`_assets/...`、`/_assets/...`。 |
| `caption` | | 图片说明（图题）。 |
| `width` | | 显示宽度（像素）。 |
| `align` | | 对齐方式：`left` / `center` / `right`，默认 `center`。 |

**旧版（仅读取兼容）**：

- `![caption](url)`
- `![caption](url "title-text")` —— `title` 会作为 caption
- `![caption](url)<!-- img:600&center -->` —— 带 width 和 align 的注释形式

### 视频 `<video-block>`

```markdown
<video-block url="./_assets/abc/def/clip.mp4" caption="演示视频" width="800" align="center"></video-block>
```

属性同 `<image-block>`。**旧版**：`![caption](url)<!-- video:800&center -->`。

### 音频 `<audio-block>`

```markdown
<audio-block url="./_assets/abc/def/song.mp3" name="歌曲名" caption="副标题" preview="true"></audio-block>
```

| 属性 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | 音频地址。 |
| `name` | | 文件名 / 主标题。 |
| `caption` | | 副标题 / 描述。 |
| `preview` | | `true` / `false`，是否显示波形预览，默认 `true`。 |

**旧版**：`![name](url)<!-- audio:caption&true -->`。

### 文件附件 `<file-block>`

```markdown
<file-block url="./_assets/abc/def/doc.pdf" name="文档.pdf" caption="可选说明"></file-block>
```

| 属性 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | 文件地址。 |
| `name` | | 显示文件名。 |
| `caption` | | 可选描述。 |

**旧版**：`[name](url)<!-- file:caption -->`。

---

## 十二、行内格式

| 格式 | 语法 | 示例 |
|------|------|------|
| 粗体 | `**text**` | `**重要**` |
| 斜体 | `*text*` | `*强调*` |
| 行内代码 | `` `code` `` | `` `var x = 1` `` |
| 链接 | `[text](url)` | `[Google](https://google.com)` |
| 提及（@页面） | `[mention:UUID](UUID)`（系统内部生成，含零宽前缀） | 一般不要手写，由编辑器 @ 触发 |
| 颜色 / 删除线 / 下划线 | `<span text-color="..." bg-color="..." strike="true" underline="true">text</span>` | `<span text-color="red" underline="true">红字下划线</span>` |

注意：

- 粗体 / 斜体 / 行内代码 可以**叠加**，但嵌套顺序影响渲染（系统会按 code → bold → italic → link 的顺序嵌套）。
- `<span>` 的属性都是可选的，但至少要有 1 个属性才会被保留。
- `<span>` 内部还可以嵌套粗体 / 斜体 / 代码 / 链接，例如 `<span text-color="blue">蓝色 **粗体**</span>`。
- 提及链接用零宽字符前缀（U+200B U+200B）+ UUID 作为链接文本来识别；手写不推荐，应通过编辑器的 `@` 命令生成。

---

## 十三、颜色调色板

`<mark color>`、`<span text-color>` / `<span bg-color>`、表格单元格 `bg` 都使用同一套颜色名：

| 颜色名 | 用途 |
|--------|------|
| `default` | 默认（普通文字色、透明背景） |
| `gray` | 灰 |
| `brown` | 棕 |
| `red` | 红 |
| `orange` | 橙 |
| `yellow` | 黄 |
| `green` | 绿 |
| `blue` | 蓝 |
| `purple` | 紫 |
| `pink` | 粉 |

`<mark>` 块的渲染：每种颜色对应一套（文字色、浅背景、深左边框），由前端 CSS 固定映射，无法自定义颜色值。
`<span>` 的 `text-color` / `bg-color` 同样只能用上述颜色名。

---

## 十四、文件与目录路径约定

### 资源 `_assets/`

每个**页面**（即每个 `.md` 文件）可以在同名文件夹的 `_assets/` 下存放图片、视频、音频、文件附件：

```
docs/<space-slug>/
├── 我的页面.md                    ← 页面
├── 我的页面/                      ← 该页面的子目录（含资源）
│   ├── _assets/
│   │   └── <uuid1>/<uuid2>/photo.png
│   └── 子页面.md
└── _files/                        ← space 级共享文件池（见下）
```

引用方式（媒体块的 `url` 属性）：

- `./_assets/uuid1/uuid2/photo.png` ← 推荐（最明确）
- `_assets/uuid1/uuid2/photo.png`
- `/_assets/uuid1/uuid2/photo.png`

三种写法都解析到同一文件。前端会自动转换为 `/api/spaces/<slug>/pages/<pageId>/assets/<path>` 调用后端。

### 共享文件 `_files/`

每个 **space** 在根目录下有 `_files/` 子目录作为 space 级共享文本文件池，供 `<content />` 块引用：

```
docs/<space-slug>/_files/
├── config.json
├── scripts/
│   └── deploy.sh
└── notes/
    └── meeting.md
```

`<content file="_files/...">` 路径必须以 `_files/` 开头，相对 space 目录；支持任意深度的子目录。`_files/` 下的文件可由外部工具（SSH、git 等）直接编辑，下次加载页面天然反映最新内容。

### 忽略规则

- 以 `.` 开头的文件和文件夹（如 `.DS_Store`、`.git/`）会被扫描器忽略。
- `_assets/`、`_files/` 不作为页面或 space 处理。

### 目录 → 数据映射

```
docs/                              ← Space 根目录
├── <space-name>/                  ← 一个 Space（= 直接子文件夹）
│   ├── README.md                  ← 一个 Page（= .md 文件）
│   ├── README/                    ← 与 .md 同名的文件夹 = 该 Page 的子页面目录
│   │   └── 子页面.md
│   ├── _assets/                   ← 资源
│   └── _files/                    ← 共享文件
└── ...
```

---

## 十五、特殊语义说明

### 空段落的零宽空格

MD 文件中**连续空行**会被解析器视为段落分隔（即"没有段落"）。要表达"这里有一个空段落"，必须在该行写一个**零宽空格 `​` (U+200B)**：

```markdown
第一段

​
（上面是一个空段落）
第三段
```

### 标签必须按行匹配

`<toggle-h>`、`<toggle-list>`、`<column-list>`、`<column>`、`<table-block>`、`<mark>` 的开始 / 结束标签**必须独占一行**（标签前后的空白允许，但不能与其他文本同行）。这是为了与下方子内容明确分隔。例外：`<mark>` 允许与文本同行（单行形式 `<mark color="blue">文本</mark>`）。

### HTML 属性的转义

所有自定义标签的属性值都用双引号 `"`。属性值内的特殊字符按下表转义：

| 原字符 | 转义为 |
|--------|--------|
| `&` | `&amp;` |
| `"` | `&quot;` |
| `<` | `&lt;` |
| `>` | `&gt;` |

例如：文件名含双引号时写 `name="file &quot;v2&quot;.pdf"`。

### BlockNote 内部 ID 与磁盘文件不直接对应

- 页面 UUID 存在 frontmatter 的 `id` 字段，**不**出现在 .md 文件名中。
- 子页面关系通过"父 .md 同名文件夹"在文件系统表达，**不**通过 .md 内的 id 链。
- `<page-ref>` / `<sub-page>` 引用页面时只认 UUID，目标页面被改名 / 移动位置不影响引用。

### 不支持的常见 Markdown 语法

- ❌ GFM pipe 表格（必须用 `<table-block>` 包裹）
- ❌ 5/6 级标题（仅支持 1–4 级）
- ❌ 嵌套缩进列表（用子页面 / 折叠块表达层级）
- ❌ 脚注 `[^1]`
- ❌ 定义列表
- ❌ 任务列表带 emoji 自定义符号（只有 `- [ ]` / `- [x]`）
- ❌ 数学公式（KaTeX/MathJax 未集成）
- ❌ 原生 HTML（除本文档列出的自定义标签外，其他 HTML 标签按字面文本处理）

---

## 附录：自定义标签速查表

| 标签 | 形式 | 必填属性 | 用途 |
|------|------|---------|------|
| `<table-block>` | 配对 | — | 包裹表格（pipe 或 JSON） |
| `<toggle-h level="N">` | 配对 | `level` | 折叠标题 |
| `<toggle-list>` | 配对 | — | 折叠列表项 |
| `<column-list ratios="...">` | 配对 | — | 多列容器 |
| `<column ratio="N">` | 配对 | — | 单列 |
| `<mark color="...">` | 配对 / 单行 | — | 高亮块 |
| `<content file="..." lang="..." />` | 自闭合 | `file` | 文件内容块 |
| `<page-ref data-id="UUID" />` | 自闭合（成对写） | `data-id` | 页面引用 |
| `<sub-page data-id="UUID" />` | 自闭合（成对写） | `data-id` | 子页面 |
| `<book-mark data-url="URL" />` | 自闭合（成对写） | `data-url` | 书签 |
| `<image-block url="..." ... />` | 自闭合（成对写） | `url` | 图片 |
| `<video-block url="..." ... />` | 自闭合（成对写） | `url` | 视频 |
| `<audio-block url="..." ... />` | 自闭合（成对写） | `url` | 音频 |
| `<file-block url="..." ... />` | 自闭合（成对写） | `url` | 文件附件 |
| `<span text-color="..." ...>` | 行内配对 | — | 行内颜色 / 删除线 / 下划线 |

"自闭合（成对写）"指：实际落盘写成 `<image-block ...></image-block>`，但语义上无 body 内容；标签中间不要写任何东西。
