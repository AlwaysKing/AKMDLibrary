/**
 * Custom UI component implementations for BlockNote.
 * These replace the Mantine/ShadCN components, giving us full control
 * over styling for pixel-perfect Notion replication.
 */
import React, {
  createContext,
  forwardRef,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  ComponentType,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useBlockNoteEditor } from '@blocknote/react';

// ==================== Menu Context ====================
interface MenuContextValue {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  position?: string;
}

const MenuContext = createContext<MenuContextValue>({
  isOpen: false,
  setOpen: () => {},
});

// ==================== Popover Context ====================
interface PopoverContextValue {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const PopoverContext = createContext<PopoverContextValue>({
  isOpen: false,
  setOpen: () => {},
});

// ==================== SideMenu ====================
const SideMenuRoot: React.FC<{ className?: string; children?: ReactNode; [key: string]: any }> = (props) => {
  const { className, children, ...rest } = props;
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
};

// 动态样式表管理：用于 block 选中高亮，避免 ProseMirror 重渲染覆盖 DOM class
let blockSelectionStyleEl: HTMLStyleElement | null = null;
let currentSelectedIds: string[] = [];

export function getSelectedBlockIds(): string[] {
  return [...currentSelectedIds];
}

function setBlockSelection(blockIds: string[] | null) {
  currentSelectedIds = blockIds || [];
  if (!blockSelectionStyleEl) {
    blockSelectionStyleEl = document.createElement('style');
    blockSelectionStyleEl.id = 'block-selection-style';
    document.head.appendChild(blockSelectionStyleEl);
  }
  if (blockIds && blockIds.length > 0) {
    const rules = blockIds.map(id => `
      .bn-block-outer:has(> [data-id="${id}"]) {
        position: relative;
      }
      .bn-block-outer:has(> [data-id="${id}"])::after {
        content: '';
        position: absolute;
        inset: 2px;
        background: rgba(35, 131, 226, 0.14);
        border-radius: 4px;
        pointer-events: none;
      }
    `).join('\n');
    blockSelectionStyleEl.textContent = rules;
  } else {
    blockSelectionStyleEl.textContent = '';
  }
}

export { setBlockSelection };

export function clearBlockSelection() {
  setBlockSelection(null);
}

const SideMenuButton: React.FC<{
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  icon?: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  label?: string;
  children?: ReactNode;
}> = (props) => {
  const { className, onClick, icon, draggable, onDragStart, onDragEnd, label, children } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const editor = useBlockNoteEditor();

  // Multi-block drag state
  const multiDragRef = useRef<{
    primaryId: string;
    otherIds: string[];
    beforeBlocks: Array<{ id: string; data: any }>;
    afterBlocks: Array<{ id: string; data: any }>;
  } | null>(null);
  const multiDragGhostRef = useRef<{ ghost: HTMLDivElement; moveGhost: (de: DragEvent) => void } | null>(null);

  // Intercept "+" button click: insert empty block and open slash menu
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Detect if this is the "+" add button (not the drag handle)
    const isAddButton = !draggable;
    if (isAddButton && editor) {
      e.preventDefault();
      e.stopPropagation();

      // Find the block this side menu belongs to
      const sideMenu = buttonRef.current?.closest('.bn-side-menu');
      const blockOuter = sideMenu?.closest('.bn-block-outer');
      if (!blockOuter) return;

      const blockContainer = blockOuter.querySelector('[data-node-type="blockContainer"]') || blockOuter;
      const blockId = blockContainer.getAttribute('data-id') || blockOuter.getAttribute('data-id');
      if (!blockId) return;

      // Insert a new empty paragraph block after the current block
      const newBlocks = editor.insertBlocks([{ type: 'paragraph' }], blockId, 'after');
      if (newBlocks.length > 0) {
        // Focus the new block
        editor.focus();
        // Open slash menu so user can pick block type
        setTimeout(() => {
          try {
            (editor as any).suggestionMenu?.openSuggestionMenu?.('/');
          } catch {
            // fallback: try dispatching "/" key
          }
        }, 50);
      }
      return;
    }

    // For drag handle, use original behavior
    onClick?.(e);
  }, [draggable, editor, onClick]);

  // 使用原生 DOM 事件，确保 dispatchEvent 和真实点击都能触发
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn || !draggable) return;

    const handleNativeClick = () => {
      const sideMenu = btn.closest('.bn-side-menu');
      if (!sideMenu) return;

      const wrapper = sideMenu.closest('[data-floating-ui-focusable]');
      if (!wrapper) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const elements = document.elementsFromPoint(wrapperRect.right + 20, wrapperRect.top + 2);
      let targetBlockId: string | null = null;
      for (const el of elements) {
        const blockOuter = (el as HTMLElement).closest('.bn-block-outer');
        if (blockOuter) {
          const bc = blockOuter.querySelector('[data-node-type="blockContainer"]') || blockOuter;
          targetBlockId = bc.getAttribute('data-id') || blockOuter.getAttribute('data-id');
          break;
        }
      }

      if (!targetBlockId) return;

      // Don't override multi-selection if block is already selected
      const currentSelection = getSelectedBlockIds();
      if (currentSelection.includes(targetBlockId) && currentSelection.length > 1) return;

      // 延迟到 BlockNote/ProseMirror 重渲染完成后再应用样式
      setTimeout(() => {
        setBlockSelection([targetBlockId]);
      }, 100);
    };

    // Native dragstart: capture multi-block data
    const handleNativeDragStart = (e: Event) => {
      multiDragRef.current = null;

      // Find block ID the same way as handleNativeClick (side menu is in a floating portal)
      const sideMenu = btn.closest('.bn-side-menu');
      if (!sideMenu) return;
      const wrapper = sideMenu.closest('[data-floating-ui-focusable]');
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const elements = document.elementsFromPoint(wrapperRect.right + 20, wrapperRect.top + 2);
      let blockId: string | null = null;
      for (const el of elements) {
        const blockOuter = (el as HTMLElement).closest('.bn-block-outer');
        if (blockOuter) {
          const bc = blockOuter.querySelector('[data-node-type="blockContainer"]') || blockOuter;
          blockId = bc.getAttribute('data-id') || blockOuter.getAttribute('data-id');
          break;
        }
      }
      if (!blockId) return;

      const selectedIds = getSelectedBlockIds();
      if (!selectedIds.includes(blockId) || selectedIds.length <= 1) return;

      const allBlocks = editor.document;
      const primaryIndex = allBlocks.findIndex(b => b.id === blockId);

      const beforeBlocks: Array<{ index: number; id: string; data: any }> = [];
      const afterBlocks: Array<{ index: number; id: string; data: any }> = [];

      for (const id of selectedIds) {
        if (id === blockId) continue;
        const idx = allBlocks.findIndex(b => b.id === id);
        const block = allBlocks[idx];
        if (!block) continue;
        const blockData = { type: block.type, props: { ...block.props }, content: block.content, children: block.children };
        if (idx < primaryIndex) {
          beforeBlocks.push({ index: idx, id, data: blockData });
        } else {
          afterBlocks.push({ index: idx, id, data: blockData });
        }
      }

      beforeBlocks.sort((a, b) => a.index - b.index);
      afterBlocks.sort((a, b) => a.index - b.index);

      multiDragRef.current = {
        primaryId: blockId,
        otherIds: [...beforeBlocks, ...afterBlocks].map(b => b.id),
        beforeBlocks,
        afterBlocks,
      };

      // Visual feedback: mark selected blocks as being dragged
      for (const id of selectedIds) {
        const blockEl = document.querySelector(`[data-id="${id}"]`);
        const outer = blockEl?.closest('.bn-block-outer') as HTMLElement | null;
        if (outer) outer.dataset.multiDrag = '';
      }

      // --- Custom floating ghost (replaces native drag image) ---
      // Get editor width for ghost sizing
      const editorEl = document.querySelector('.bn-editor');
      const editorWidth = editorEl ? editorEl.getBoundingClientRect().width : 600;

      const ghost = document.createElement('div');
      ghost.style.cssText = `position:fixed;z-index:99999;pointer-events:none;opacity:0.7;width:${editorWidth}px;`;

      // Wrap with inline styles matching editor appearance (no bn-* classes to avoid BlockNote interference)
      const ghostRoot = document.createElement('div');
      const ghostEditor = document.createElement('div');
      ghostEditor.style.cssText = 'font-size:16px;line-height:1.5;color:#2c2c2b;padding:0;';
      ghostRoot.appendChild(ghostEditor);

      for (const id of selectedIds) {
        const blockEl = document.querySelector(`[data-id="${id}"]`);
        const outer = blockEl?.closest('.bn-block-outer') as HTMLElement | null;
        if (outer) {
          const clone = outer.cloneNode(true) as HTMLElement;
          clone.removeAttribute('data-multi-drag');
          // Strip BlockNote-specific attributes so its internal drag system ignores the ghost
          clone.querySelectorAll('[data-id]').forEach(el => el.removeAttribute('data-id'));
          clone.querySelectorAll('[data-node-type]').forEach(el => el.removeAttribute('data-node-type'));
          clone.querySelectorAll('[data-content-type]').forEach(el => {
            // Keep the attribute for styling but prefix to avoid BlockNote recognition
            const val = el.getAttribute('data-content-type');
            if (val) {
              el.removeAttribute('data-content-type');
              el.setAttribute('data-ghost-content-type', val);
            }
          });
          ghostEditor.appendChild(clone);
        }
      }

      ghost.appendChild(ghostRoot);
      document.body.appendChild(ghost);

      // Position ghost at mouse
      const dragEvt = e as DragEvent;
      ghost.style.left = `${dragEvt.clientX + 4}px`;
      ghost.style.top = `${dragEvt.clientY + 4}px`;

      // Move ghost with drag events
      const moveGhost = (de: DragEvent) => {
        // Last drag event has clientX/clientY = 0, skip it
        if (de.clientX === 0 && de.clientY === 0) return;
        ghost.style.left = `${de.clientX + 4}px`;
        ghost.style.top = `${de.clientY + 4}px`;
      };
      btn.addEventListener('drag', moveGhost);
      multiDragGhostRef.current = { ghost, moveGhost };

      // Hide BlockNote's native drag ghost: add body class so CSS makes .bn-drag-preview
      // invisible BEFORE BlockNote creates it and calls setDragImage.
      document.body.classList.add('multi-drag-active');
    };

    // Native dragend: move other blocks to join the primary
    const handleNativeDragEnd = () => {
      // Remove body class that hides native drag preview
      document.body.classList.remove('multi-drag-active');

      // Clean up floating ghost
      if (multiDragGhostRef.current) {
        const { ghost, moveGhost } = multiDragGhostRef.current;
        btn.removeEventListener('drag', moveGhost);
        ghost.remove();
        multiDragGhostRef.current = null;
      }

      if (!multiDragRef.current) return;

      const captured = multiDragRef.current;
      multiDragRef.current = null;

      const { primaryId, otherIds, beforeBlocks, afterBlocks } = captured;
      const currentDoc = editor.document;

      // Remove other selected blocks (skip if already gone)
      const existingOtherIds = otherIds.filter(id => currentDoc.some(b => b.id === id));
      if (existingOtherIds.length > 0) {
        editor.removeBlocks(existingOtherIds as any);
      }

      // Re-fetch primary after removal (position may have changed)
      const docAfterRemove = editor.document;
      if (!docAfterRemove.some(b => b.id === primaryId)) {
        setBlockSelection(null);
        return;
      }

      // Insert "after" blocks after the primary (in order)
      if (afterBlocks.length > 0) {
        editor.insertBlocks(afterBlocks.map(b => b.data) as any, primaryId as any, 'after');
      }

      // Insert "before" blocks before the primary (in order)
      if (beforeBlocks.length > 0) {
        editor.insertBlocks(beforeBlocks.map(b => b.data) as any, primaryId as any, 'before');
      }

      setBlockSelection(null);

      // Clean up multi-drag visual feedback
      document.querySelectorAll('[data-multi-drag]').forEach(el => {
        delete (el as HTMLElement).dataset.multiDrag;
      });
    };

    btn.addEventListener('click', handleNativeClick);
    btn.addEventListener('dragstart', handleNativeDragStart);
    btn.addEventListener('dragend', handleNativeDragEnd);
    return () => {
      btn.removeEventListener('click', handleNativeClick);
      btn.removeEventListener('dragstart', handleNativeDragStart);
      btn.removeEventListener('dragend', handleNativeDragEnd);
    };
  }, [draggable, editor]);

  return (
    <button
      ref={buttonRef}
      className={className}
      onClick={handleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={label}
      type="button"
    >
      {children || icon}
    </button>
  );
};

// ==================== Generic Menu ====================
const GenericMenuRoot: React.FC<{
  sub?: boolean;
  onOpenChange?: (open: boolean) => void;
  position?: string;
  children?: ReactNode;
}> = (props) => {
  const { onOpenChange, position, children } = props;
  const [isOpen, setIsOpen] = useState(false);

  const setOpen = useCallback((open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  }, [onOpenChange]);

  return (
    <MenuContext.Provider value={{ isOpen, setOpen, position }}>
      <div style={{ position: 'relative', display: 'contents' }}>
        {children}
      </div>
    </MenuContext.Provider>
  );
};

const GenericMenuTrigger: React.FC<{ children?: ReactNode; sub?: boolean }> = (props) => {
  const { children } = props;
  const { isOpen, setOpen } = useContext(MenuContext);

  // Inject click handler into child element to toggle menu
  if (React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: React.MouseEvent) => {
        // Call original onClick if it exists
        const originalOnClick = (children as any).props?.onClick;
        if (originalOnClick) originalOnClick(e);
        setOpen(!isOpen);
      },
    });
  }

  return <>{children}</>;
};

const GenericMenuDropdown: React.FC<{ className?: string; children?: ReactNode; sub?: boolean }> = forwardRef((props, ref) => {
  const { className, children, sub } = props;
  const { isOpen, setOpen, position } = useContext(MenuContext);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate fixed position for drag handle menu during render (before DOM commit).
  // Portal to document.body so position:fixed is truly viewport-relative,
  // unaffected by the floating-ui ancestor's CSS transform.
  const dragHandleStyle = useMemo(() => {
    if (!isOpen || sub) return null;

    // Find the currently visible drag handle button
    const allHandles = document.querySelectorAll('[aria-label="打开菜单"]');
    let dragHandle: HTMLElement | null = null;
    for (const h of allHandles) {
      const r = h.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        dragHandle = h as HTMLElement;
        break;
      }
    }
    if (!dragHandle) return null;

    const handleRect = dragHandle.getBoundingClientRect();
    const menuWidth = 150; // match CSS min-width
    const gap = 4;

    // Left space from viewport left edge to drag handle left edge (includes sidebar)
    const leftSpace = handleRect.left;

    let left: number;
    let top: number;

    if (leftSpace >= menuWidth + gap) {
      // Enough space on the left — pop left
      left = handleRect.left - menuWidth - gap;
      top = handleRect.top;
    } else {
      // Not enough space on the left — pop right, start after the drag handle
      left = handleRect.right + gap;
      top = handleRect.top;

      // Clamp if overflows right edge
      if (left + menuWidth > window.innerWidth - gap) {
        left = window.innerWidth - menuWidth - gap;
      }
    }

    // Clamp top to viewport
    top = Math.max(4, Math.min(top, window.innerHeight - 100));

    return {
      position: 'fixed' as const,
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 10000,
    };
  }, [isOpen, sub]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      const sideMenu = document.querySelector('.bn-side-menu');
      if (sideMenu?.contains(target)) return;
      setOpen(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOpen]);

  if (!isOpen) return null;

  const setRefs = (node: HTMLDivElement | null) => {
    (dropdownRef as any).current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as any).current = node;
  };

  // Drag handle menu — portal to body, fixed positioning (avoids transform ancestor)
  if (dragHandleStyle) {
    return createPortal(
      <div ref={setRefs} className={className} style={dragHandleStyle}>
        {children}
      </div>,
      document.body
    );
  }

  // Other menus / sub-menus — absolute positioning within parent
  return (
    <div
      ref={setRefs}
      className={className}
      style={{
        position: 'absolute',
        zIndex: 10000,
        ...(position?.includes('left') ? { right: '100%', marginRight: 4 } : { left: '100%', marginLeft: 4 }),
        top: 0,
      }}
    >
      {children}
    </div>
  );
});

const GenericMenuItem: React.FC<{
  className?: string;
  children?: ReactNode;
  icon?: ReactNode;
  checked?: boolean;
  onClick?: () => void;
  subTrigger?: boolean;
}> = forwardRef((props, ref) => {
  const { className, children, icon, checked, onClick } = props;
  const { setOpen } = useContext(MenuContext);

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      onClick={() => {
        onClick?.();
        setOpen(false);
      }}
      role="menuitem"
    >
      {icon && <span className="bn-menu-item-icon">{icon}</span>}
      {children}
      {checked !== undefined && (
        <span className="bn-menu-item-check">
          {checked ? '✓' : ''}
        </span>
      )}
    </div>
  );
});

const GenericMenuLabel: React.FC<{ className?: string; children?: ReactNode }> = (props) => {
  const { className, children } = props;
  return <div className={className}>{children}</div>;
};

const GenericMenuDivider: React.FC<{ className?: string }> = (props) => {
  const { className } = props;
  return <hr className={className} />;
};

const GenericMenuButton: React.FC<{
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  icon?: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  label?: string;
  children?: ReactNode;
}> = (props) => {
  const { className, onClick, icon, draggable, onDragStart, onDragEnd, label, children } = props;
  return (
    <button
      className={className}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={label}
      type="button"
    >
      {children || icon}
    </button>
  );
};

// ==================== Generic Popover ====================
const GenericPopoverRoot: React.FC<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  position?: string;
  portalRoot?: HTMLElement | null;
  children?: ReactNode;
}> = (props) => {
  const { open, onOpenChange, children } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = useCallback((o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
  }, [onOpenChange]);

  return (
    <PopoverContext.Provider value={{ isOpen, setOpen }}>
      {children}
    </PopoverContext.Provider>
  );
};

const GenericPopoverTrigger: React.FC<{ children?: ReactNode }> = (props) => {
  return <>{props.children}</>;
};

const GenericPopoverContent: React.FC<{
  className?: string;
  variant?: string;
  children?: ReactNode;
}> = (props) => {
  const { className, children } = props;
  const { isOpen } = useContext(PopoverContext);

  if (!isOpen) return null;

  return (
    <div className={className}>
      {children}
    </div>
  );
};

// ==================== Toolbar (FormattingToolbar & LinkToolbar) ====================
const ToolbarRoot: React.FC<{
  className?: string;
  children?: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  variant?: string;
}> = (props) => {
  const { className, children, onMouseEnter, onMouseLeave } = props;
  return (
    <div className={className} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </div>
  );
};

const ToolbarButton: React.FC<{
  className?: string;
  mainTooltip?: string;
  secondaryTooltip?: string;
  icon?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  isDisabled?: boolean;
  variant?: string;
  label?: string;
  children?: ReactNode;
}> = (props) => {
  const { className, icon, onClick, isSelected, isDisabled, label, children } = props;
  return (
    <button
      className={className}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={label}
      data-selected={isSelected || undefined}
      type="button"
    >
      {children || icon}
    </button>
  );
};

const ToolbarSelect: React.FC<{
  className?: string;
  items: Array<{
    text: string;
    icon: ReactNode;
    onClick: () => void;
    isSelected: boolean;
    isDisabled?: boolean;
  }>;
  isDisabled?: boolean;
}> = (props) => {
  const { className, items, isDisabled } = props;
  const [isOpen, setIsOpen] = useState(false);
  const selectedItem = items.find((item) => item.isSelected);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isDisabled}
        type="button"
      >
        {selectedItem?.icon}
        {selectedItem?.text}
      </button>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', zIndex: 1000 }}>
          {items.map((item, i) => (
            <div key={i} onClick={() => { item.onClick(); setIsOpen(false); }}>
              {item.icon}
              {item.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ==================== Suggestion Menu ====================

// Desired group order — must match PageEditor's customZh group names
const GROUP_ORDER = ['基础区块', '高级区块', '列表', '媒体', '其他'];

const SuggestionMenuRoot: React.FC<{
  id?: string;
  className?: string;
  children?: ReactNode;
}> = (props) => {
  const { id, className, children } = props;

  // Reorder children so groups appear in GROUP_ORDER
  // BlockNote renders labels + items sequentially; same-group items may be split.
  // We collect children into groups keyed by their preceding label, then re-emit in order.
  const orderedChildren = React.useMemo(() => {
    const childArray = React.Children.toArray(children);
    if (childArray.length === 0) return children;

    // Partition children into groups: each label starts a new group
    const groups: { label: string; elements: React.ReactNode[] }[] = [];
    let currentGroup = '';

    for (const child of childArray) {
      if (React.isValidElement(child)) {
        // Detect label elements by their className
        const props = child.props as any;
        if (props?.className?.includes?.('bn-suggestion-menu-label')) {
          currentGroup = (child as React.ReactElement<{ children?: ReactNode }>).props?.children?.toString() || '';
          groups.push({ label: currentGroup, elements: [child] });
        } else {
          // Item — add to current group
          if (groups.length === 0) {
            groups.push({ label: currentGroup, elements: [child] });
          } else {
            groups[groups.length - 1].elements.push(child);
          }
        }
      } else {
        // Non-element child (text node etc.)
        if (groups.length === 0) {
          groups.push({ label: '', elements: [child] });
        } else {
          groups[groups.length - 1].elements.push(child);
        }
      }
    }

    // Merge groups with the same label, then sort by GROUP_ORDER
    const merged = new Map<string, React.ReactNode[]>();
    for (const g of groups) {
      const existing = merged.get(g.label);
      if (existing) {
        // Skip duplicate label element, only add items
        existing.push(...g.elements.slice(1));
      } else {
        merged.set(g.label, g.elements);
      }
    }

    // Re-emit in GROUP_ORDER, then any remaining groups
    const result: React.ReactNode[] = [];
    const seen = new Set<string>();
    for (const label of GROUP_ORDER) {
      const elements = merged.get(label);
      if (elements) {
        result.push(...elements);
        seen.add(label);
      }
    }
    for (const [label, elements] of merged) {
      if (!seen.has(label)) {
        result.push(...elements);
      }
    }
    return result;
  }, [children]);

  return (
    <div id={id} className={className}>
      {orderedChildren}
    </div>
  );
};

// Markdown shortcuts shown on the right side of each slash menu item
const SLASH_MENU_SHORTCUTS: Record<string, string> = {
  heading: '#',
  heading_2: '##',
  heading_3: '###',
  heading_4: '####',
  heading_5: '#####',
  heading_6: '######',
  toggle_heading: '#>',
  toggle_heading_2: '##>',
  toggle_heading_3: '###>',
  paragraph: '',
  bullet_list: '-',
  numbered_list: '1.',
  check_list: '[]',
  toggle_list: '>',
  quote: '""',
  code_block: '```',
  divider: '---',
  table: '||',
  image: '',
  video: '',
  audio: '',
  file: '',
  emoji: '',
  page_break: '---',
};

// English names shown as light gray text after Chinese title
const SLASH_MENU_ENGLISH: Record<string, string> = {
  heading: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  heading_4: 'Heading 4',
  heading_5: 'Heading 5',
  heading_6: 'Heading 6',
  toggle_heading: 'Toggle Heading 1',
  toggle_heading_2: 'Toggle Heading 2',
  toggle_heading_3: 'Toggle Heading 3',
  paragraph: 'Text',
  bullet_list: 'Bullet List',
  numbered_list: 'Numbered List',
  check_list: 'To-do List',
  toggle_list: 'Toggle',
  quote: 'Quote',
  code_block: 'Code',
  divider: 'Divider',
  table: 'Table',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  emoji: 'Emoji',
  page_break: 'Page Break',
};

const SuggestionMenuItem: React.FC<{
  className?: string;
  id?: string;
  isSelected: boolean;
  onClick: () => void;
  item: any;
}> = (props) => {
  const { className, id, isSelected, onClick, item } = props;
  const shortcut = SLASH_MENU_SHORTCUTS[item.key] || '';
  const english = SLASH_MENU_ENGLISH[item.key] || '';
  return (
    <div
      id={id}
      className={className}
      onClick={onClick}
      data-selected={isSelected || undefined}
    >
      {item.icon && <span className="bn-suggestion-menu-item-icon">{item.icon}</span>}
      <span className="bn-suggestion-menu-item-title">
        {item.title || item.name}
        {english && <span className="bn-suggestion-menu-item-en">{english}</span>}
      </span>
      {shortcut && <span className="bn-suggestion-menu-item-shortcut">{shortcut}</span>}
    </div>
  );
};

const SuggestionMenuEmptyItem: React.FC<{
  className?: string;
  children?: ReactNode;
}> = (props) => {
  return <div className={props.className}>{props.children || 'No results'}</div>;
};

const SuggestionMenuLabel: React.FC<{
  className?: string;
  children?: ReactNode;
}> = (props) => {
  return <div className={props.className}>{props.children}</div>;
};

const SuggestionMenuLoader: React.FC<{
  className?: string;
}> = (props) => {
  return <div className={props.className}>Loading...</div>;
};

// ==================== Grid Suggestion Menu ====================
const GridSuggestionMenuRoot: React.FC<{
  id?: string;
  columns: number;
  className?: string;
  children?: ReactNode;
}> = (props) => {
  const { id, columns, className, children } = props;
  return (
    <div id={id} className={className} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {children}
    </div>
  );
};

const GridSuggestionMenuItem: React.FC<{
  className?: string;
  id?: string;
  isSelected: boolean;
  onClick: () => void;
  item: any;
}> = (props) => {
  const { className, id, isSelected, onClick, item } = props;
  return (
    <div
      id={id}
      className={className}
      onClick={onClick}
      data-selected={isSelected || undefined}
    >
      {item.icon && <span>{item.icon}</span>}
    </div>
  );
};

const GridSuggestionMenuEmptyItem: React.FC<{
  columns: number;
  className?: string;
  children?: ReactNode;
}> = (props) => {
  return <div className={props.className}>{props.children || 'No results'}</div>;
};

const GridSuggestionMenuLoader: React.FC<{
  columns: number;
  className?: string;
  children?: ReactNode;
}> = (props) => {
  return <div className={props.className}>{props.children || 'Loading...'}</div>;
};

// ==================== Generic Form ====================
const FormRoot: React.FC<{ children?: ReactNode }> = (props) => {
  return <div>{props.children}</div>;
};

const FormTextInput: React.FC<{
  className?: string;
  name: string;
  label?: string;
  variant?: string;
  icon: ReactNode;
  rightSection?: ReactNode;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
  value: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
  autoComplete?: string;
  ['aria-activedescendant']?: string;
  ref?: React.Ref<HTMLInputElement>;
}> = forwardRef((props, ref) => {
  const {
    className,
    name,
    placeholder,
    autoFocus,
    disabled,
    value,
    onKeyDown,
    onChange,
    onSubmit,
    autoComplete,
  } = props;
  return (
    <input
      ref={ref as React.Ref<HTMLInputElement>}
      className={className}
      name={name}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onKeyDown={(e) => {
        onKeyDown(e);
        if (e.key === 'Enter') onSubmit?.();
      }}
      onChange={onChange}
      autoComplete={autoComplete}
      aria-activedescendant={props['aria-activedescendant']}
    />
  );
});

// ==================== Table Handle ====================
const TableHandleRoot: React.FC<{
  className?: string;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  style?: React.CSSProperties;
  label?: string;
  children?: ReactNode;
}> = (props) => {
  const { className, draggable, onDragStart, onDragEnd, style, children } = props;
  return (
    <div
      className={className}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={style}
    >
      {children}
    </div>
  );
};

const TableHandleExtendButton: React.FC<{
  className?: string;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  children: ReactNode;
}> = (props) => {
  const { className, onClick, onMouseDown, children } = props;
  return (
    <button className={className} onClick={onClick} onMouseDown={onMouseDown} type="button">
      {children}
    </button>
  );
};

// ==================== Export all components ====================
export const blockNoteComponents = {
  FormattingToolbar: {
    Root: ToolbarRoot,
    Button: ToolbarButton,
    Select: ToolbarSelect,
  },
  FilePanel: {
    Root: ({ children }: any) => <div>{children}</div>,
    Button: ToolbarButton,
    FileInput: forwardRef((props: any, ref) => <input ref={ref} type="file" {...props} />) as any,
    TabPanel: ({ children }: any) => <div>{children}</div>,
    TextInput: FormTextInput,
  },
  GridSuggestionMenu: {
    Root: GridSuggestionMenuRoot,
    Item: GridSuggestionMenuItem,
    EmptyItem: GridSuggestionMenuEmptyItem,
    Loader: GridSuggestionMenuLoader,
  },
  LinkToolbar: {
    Root: ToolbarRoot,
    Button: ToolbarButton,
    Select: ToolbarSelect,
  },
  SideMenu: {
    Root: SideMenuRoot,
    Button: SideMenuButton,
  },
  SuggestionMenu: {
    Root: SuggestionMenuRoot,
    Item: SuggestionMenuItem,
    EmptyItem: SuggestionMenuEmptyItem,
    Label: SuggestionMenuLabel,
    Loader: SuggestionMenuLoader,
  },
  TableHandle: {
    Root: TableHandleRoot,
    ExtendButton: TableHandleExtendButton,
  },
  Generic: {
    Badge: {
      Root: ({ text, icon, isSelected, onClick }: any) => (
        <div onClick={onClick} data-selected={isSelected}>
          {icon}{text}
        </div>
      ),
      Group: ({ children }: any) => <div>{children}</div>,
    },
    Form: {
      Root: FormRoot,
      TextInput: FormTextInput,
    },
    Menu: {
      Root: GenericMenuRoot,
      Trigger: GenericMenuTrigger,
      Dropdown: GenericMenuDropdown,
      Divider: GenericMenuDivider,
      Label: GenericMenuLabel,
      Item: GenericMenuItem,
      Button: GenericMenuButton,
    },
    Popover: {
      Root: GenericPopoverRoot,
      Trigger: GenericPopoverTrigger,
      Content: GenericPopoverContent,
    },
    Toolbar: {
      Root: ToolbarRoot,
      Button: ToolbarButton,
      Select: ToolbarSelect,
    },
  },
  Comments: {
    Card: ({ children }: any) => <div>{children}</div>,
    CardSection: ({ children }: any) => <div>{children}</div>,
    ExpandSectionsPrompt: ({ children }: any) => <div>{children}</div>,
    Editor: ({ editor: _editor }: any) => <div />,
    Comment: ({ children }: any) => <div>{children}</div>,
  },
};
