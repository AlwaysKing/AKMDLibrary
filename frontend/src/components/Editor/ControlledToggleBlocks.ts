import { defaultBlockSpecs, createToggleWrapper, wrapInBlockStructure } from '@blocknote/core';

/**
 * 受控 toggle 块：把"展开/折叠"从视图旁路（DOM 属性 + localStorage + 按索引传数组）
 * 变成真正的 block 属性（props.expanded），随文档序列化/反序列化。
 *
 * 覆盖 defaultBlockSpecs 的 heading / toggleListItem，其余行为保持原样：
 * - propSchema 追加 expanded（默认 true）
 * - render 仍用 BlockNote 的 createToggleWrapper（DOM 结构、CSS、data-show-children
 *   属性完全不变），只替换 toggledState 的读写来源：
 *     get  → block.props.expanded
 *     set  → editor.updateBlock（文档事务，可撤销、触发自动保存）
 *
 * set 走 queueMicrotask：createToggleWrapper 的 onChange 回调在事务派发期间同步触发，
 * 直接嵌套 updateBlock 会撞上 ProseMirror 的 dispatch；延迟到微任务再执行。
 * 点击折叠时 createToggleWrapper 已先同步写好 DOM 属性，视觉上无延迟。
 */
function createBlockPropToggledState(editor: any) {
  return {
    get: (block: any) => block?.props?.expanded !== false,
    set: (block: any, isToggled: boolean) => {
      queueMicrotask(() => {
        try {
          editor.updateBlock(block, { props: { expanded: isToggled } } as any);
        } catch (err) {
          // 块可能在微任务执行前已被删除，忽略即可
          console.error('[ControlledToggle] update expanded failed', err);
        }
      });
    },
  };
}

const defaultHeadingSpec: any = defaultBlockSpecs.heading as any;
const defaultToggleListItemSpec: any = defaultBlockSpecs.toggleListItem as any;

// 扩展后的 propSchema：追加 expanded（默认 true），config 与 render 共用
const headingPropSchema = {
  ...defaultHeadingSpec.config.propSchema,
  expanded: { default: true },
};
const toggleListItemPropSchema = {
  ...defaultToggleListItemSpec.config.propSchema,
  expanded: { default: true },
};

// 折叠标题：展开状态跟随 block.props.expanded
export const ControlledHeadingBlockSpec: any = {
  ...defaultHeadingSpec,
  config: {
    ...defaultHeadingSpec.config,
    propSchema: headingPropSchema,
  },
  implementation: {
    ...defaultHeadingSpec.implementation,
    // 必须丢弃原 node：BlockNoteSchema 会复用 implementation.node（其 attrs 来自
    // 旧 propSchema），置空后才会按扩展后的 propSchema 重建，expanded 才能进文档
    node: undefined,
    render(block: any, editor: any) {
      const dom = document.createElement(`h${block.props.level}`);
      const toggleWrapper = createToggleWrapper(block, editor, dom, createBlockPropToggledState(editor));
      // 默认实现的 render 由 createBlockSpec 工厂用 wrapInBlockStructure 包上
      // .bn-block-content（携带 data-content-type / data-level 等属性），heading
      // 字号与折叠隐藏 children 的 CSS 都依赖这一层，覆盖 render 时必须补上。
      return wrapInBlockStructure(
        { ...toggleWrapper, contentDOM: dom },
        'heading',
        block.props,
        headingPropSchema,
        false,
        (this as any).blockContentDOMAttributes,
      );
    },
  },
};

// 折叠列表：同上
export const ControlledToggleListItemBlockSpec: any = {
  ...defaultToggleListItemSpec,
  config: {
    ...defaultToggleListItemSpec.config,
    propSchema: toggleListItemPropSchema,
  },
  implementation: {
    ...defaultToggleListItemSpec.implementation,
    node: undefined,
    render(block: any, editor: any) {
      const paragraphEl = document.createElement('p');
      const toggleWrapper = createToggleWrapper(block, editor, paragraphEl, createBlockPropToggledState(editor));
      return wrapInBlockStructure(
        { ...toggleWrapper, contentDOM: paragraphEl },
        'toggleListItem',
        block.props,
        toggleListItemPropSchema,
        false,
        (this as any).blockContentDOMAttributes,
      );
    },
  },
};
