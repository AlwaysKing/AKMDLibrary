# Notion 样式对齐 & Block 元素功能设计文档

## 概述

对 MDLibrary 前端进行两个重大改造：
1. **样式全面向 Notion 对齐** — 字体、字号、行高、颜色、间距等
2. **Block 元素功能** — 添加按钮、六点拖拽手柄、/菜单、样式组件

参考源：`notion-example/docs/notion-snapshots/`

---

## 一、Notion 样式全面对齐

### 1.1 编辑器样式（针对 BlockNote）

| 属性 | Notion 值 | 当前值 | 改动文件 |
|------|-----------|--------|---------|
| 编辑器字体大小 | 16px | 15px | globals.css |
| 段落行高 | 1.5-1.6 | 1.7 | globals.css |
| 文本颜色 | #37352f (light) / #2c2c2b | #37352f | ✅ 正确 |
| 粗体字重 | 600 | 600 | ✅ 正确 |
| 块间距 | 2px padding | 1px padding | globals.css |
| H1 字号 | 1.875em (30px) | 1.875em | ✅ 正确 |
| H2 字号 | 1.5em (24px) | 1.5em | ✅ 正确 |
| H3 字号 | 1.25em (20px) | 1.25em | ✅ 正确 |

### 1.2 BlockNote CSS 变量覆盖

BlockNote 使用 CSS 变量控制主题颜色。通过覆盖这些变量实现 Notion 配色：

```css
.bn-root {
  --bn-colors-editor-text: #37352f;
  --bn-colors-editor-background: #ffffff;
  --bn-colors-menu-text: #37352f;
  --bn-colors-menu-background: #ffffff;
  --bn-colors-hovered-background: #ebebea;
  --bn-colors-selected-background: #2383e2;
  --bn-colors-side-menu: #9b9a97;
  --bn-colors-border: #e9e9e7;
  --bn-colors-shadow: rgba(0, 0, 0, 0.08);
  --bn-font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --bn-border-radius: 8px;
}
```

### 1.3 侧边栏样式对齐

从 notion-example 快照提取的侧边栏属性：
- 背景色: #f7f6f3 (已匹配)
- 页面项字体: 14px, weight 500, color #5f5e59
- 页面项高度: 30px
- 缩进: 逐级增加 20-24px
- 嵌套线颜色: rgba(0, 0, 0, 0.1)

### 1.4 页面标题样式对齐

Notion 页面标题快照值：
- 字号: 40px
- 行高: 48px (1.2)
- 字重: 700
- padding: 0 8px
- placeholder 文本: #c4c3c0

### 1.5 BlockNote 拖拽手柄、添加按钮样式

- 六点图标颜色: rgba(0, 0, 0, 0.6) (drag-handle-color)
- 添加按钮 (+): #9b9a97, hover 变深
- hover 时侧边栏透明出现
- svg 六点图标替代默认 Material Design DragIndicator

### 1.6 Highlighter/文本颜色

Notion 使用高亮色板:
- Gray: #9b9a97 / #ebeced
- Brown: #64473a / #e9e5e3
- Red: #e03e3e / #fbe4e4
- Orange: #d9730d / #f6e9d9
- Yellow: #dfab01 / #fbf3db
- Green: #4d6461 / #ddedea
- Blue: #0b6e99 / #ddebf1
- Purple: #6940a5 / #eae4f2
- Pink: #ad1a72 / #f4dfeb

这些与 BlockNote 默认值一致，无需更改。

---

## 二、Block 元素功能

### 2.1 侧边菜单（SideMenu）

当前已通过 `BlockNoteViewRaw` 启用。需要：

1. **添加按钮 (+)**
   - 悬停在块左侧时显示
   - 点击在当前块上方添加新段落并打开 `/` 菜单
   - 使用 `+` 图标（Notion 风格）

2. **六点拖拽手柄 ⠿**
   - 拖拽移动块
   - 点击打开上下文菜单
   - 使用六点图标（⠿ SVG）
   - 菜单项：删除、复制、转换为类型、颜色选择等

3. **侧边菜单行为**
   - 默认透明隐藏
   - 悬停块时淡入显示
   - 颜色: rgba(0, 0, 0, 0.6)

### 2.2 / 菜单（Slash Menu）

已启用，需要：
1. 样式对齐 Notion
2. 菜单项分组（基础、媒体、高级等）
3. 搜索过滤
4. 圆角、阴影、hover 效果

### 2.3 格式工具栏（FormattingToolbar）

Notion 风格的内联工具栏：
- 选中文本时弹出
- 选项：Bold(加粗), Italic(斜体), Strikethrough(删除线), Code(代码), Color(颜色)
- 圆角、阴影

### 2.4 "之前要求的样式组件"

从之前的对话和 CSS 快照看，包括：
- Cover 图片: 高度 30vh, max-height 280px (已部分实现)
- Icon 选择器: emoji 选择已经实现
- Page title: 40px bold (已实现)

---

## 三、实现方案

### 技术方案

**方案 A — 使用 BlockNote 原生组件 + CSS 覆盖 (推荐)** 
直接在现有 `BlockNoteViewRaw` 基础上，通过 CSS 变量和额外样式覆盖实现 Notion 风格。优点：改动最小、不破坏现有逻辑。

**方案 B — 自定义 SideMenu 组件**
创建自定义 React 组件替换 BlockNote 默认的 SideMenu。优点：完全控制 UI。缺点：复杂度高。

**推荐方案 A** — 因为所有功能（侧边菜单、拖拽、/菜单）已经在 BlockNote 0.50 中可用，只需调整样式即可。

### 修改文件清单

| 文件 | 改动内容 |
|------|---------|
| `frontend/src/styles/globals.css` | 全面更新 BlockNote 主题 CSS 变量和样式覆盖 |
| `frontend/src/components/Editor/PageEditor.tsx` | 添加 `sideMenu` 和格式化工具栏支持和主题定制 |
| `frontend/tailwind.config.js` | 可能的新颜色变量 |
| `frontend/src/components/Layout/Sidebar.tsx` | 侧边栏项 Notion 样式对齐 |
| `frontend/src/components/Sidebar/PageTreeItem.tsx` | 页面树项样式对齐 |
| `frontend/src/pages/PageViewPage.tsx` | 页面标题样式确认 |

### 验收标准

1. 编辑器中的块左侧出现 `+` 和六点 `⠿` 按钮
2. 六点按钮可拖拽移动块
3. 点击六点打开菜单（删除、颜色等）
4. `/` 呼出菜单样式接近 Notion
5. 整体字体、字号、行高对齐 Notion
6. 颜色、选中效果对齐 Notion
7. Chrome 浏览器中可对比验证

---

## 四、风险与注意事项

1. BlockNote 0.50 的 SideMenu 默认使用 `react-icons/md` 的 `MdDragIndicator`（三条横线），需要替换为六点图标
2. 侧边菜单的透明度/悬停行为可能需要 CSS 调整
3. 可能需要检查 BlockNote 版本兼容性
