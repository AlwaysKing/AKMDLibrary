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
import { showToast } from '../Toast';

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
let dragMenuOpen = false;

export function isDragMenuOpen(): boolean {
  return dragMenuOpen;
}

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
        inset: 1px 2px;
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
    dragMenuOpen = open;
    // Keep side menu visible and active while drag menu is open
    // Use body class so CSS selector `body.drag-menu-open` has enough specificity
    if (open) {
      document.body.classList.add('drag-menu-open');
    } else {
      document.body.classList.remove('drag-menu-open');
    }
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
    const menuWidth = 200; // drag handle menu width
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
        <DragHandleMenuContent onClose={() => setOpen(false)} />
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

// ==================== Drag Handle Menu ====================

// Preset color definitions (matching BlockNote defaultColors)
const COLORS: Record<string, { text: string; background: string }> = {
  gray:    { text: '#9b9a97', background: '#ebeced' },
  brown:   { text: '#64473a', background: '#e9e5e3' },
  red:     { text: '#e03e3e', background: '#fbe4e4' },
  orange:  { text: '#d9730d', background: '#f6e9d9' },
  yellow:  { text: '#dfab01', background: '#fbf3db' },
  green:   { text: '#4d6461', background: '#ddedea' },
  blue:    { text: '#0b6e99', background: '#ddebf1' },
  purple:  { text: '#6940a5', background: '#eae4f2' },
  pink:    { text: '#ad1a72', background: '#f4dfeb' },
};

// Block types available for "Turn into" conversion
interface TurnIntoOption {
  type: string;
  label: string;
  props?: Record<string, any>;
  iconPath: string; // Notion SVG path
}

const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { type: 'paragraph', label: '文本', iconPath: 'M4.875 4.825c0-.345.28-.625.625-.625h9c.345 0 .625.28.625.625v1.8a.625.625 0 1 1-1.25 0V5.45h-3.25v9.1h.725a.625.625 0 1 1 0 1.25h-2.7a.625.625 0 1 1 0-1.25h.725v-9.1h-3.25v1.175a.625.625 0 1 1-1.25 0z' },
  { type: 'heading', label: '标题 1', props: { level: 1 }, iconPath: 'M4.1 4.825a.625.625 0 0 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15H4.1zM17.074 8.45a.6.6 0 0 1 .073.362q.003.03.003.063v6.3a.625.625 0 1 1-1.25 0V9.802l-1.55.846a.625.625 0 1 1-.6-1.098l2.476-1.35a.625.625 0 0 1 .848.25' },
  { type: 'heading', label: '标题 2', props: { level: 2 }, iconPath: 'M3.65 4.825a.625.625 0 1 0-1.25 0v10.35a.625.625 0 0 0 1.25 0V10.4h6.4v4.775a.625.625 0 0 0 1.25 0V4.825a.625.625 0 1 0-1.25 0V9.15h-6.4zm10.104 5.164c.19-.457.722-.84 1.394-.84.89 0 1.48.627 1.48 1.238 0 .271-.104.53-.302.746l-3.837 3.585a.625.625 0 0 0 .427 1.082h4.5a.625.625 0 1 0 0-1.25H14.5l2.695-2.518.027-.028c.406-.43.657-.994.657-1.617 0-1.44-1.299-2.488-2.731-2.488-1.128 0-2.145.643-2.548 1.608a.625.625 0 0 0 1.154.482' },
  { type: 'heading', label: '标题 3', props: { level: 3 }, iconPath: 'M2.877 4.2c.346 0 .625.28.625.625V9.15h6.4V4.825a.625.625 0 0 1 1.25 0v10.35a.625.625 0 0 1-1.25 0V10.4h-6.4v4.775a.625.625 0 0 1-1.25 0V4.825c0-.345.28-.625.625-.625M14.93 9.37c-.692 0-1.183.34-1.341.671a.625.625 0 1 1-1.128-.539c.416-.87 1.422-1.382 2.47-1.382.686 0 1.33.212 1.818.584.487.373.843.932.843 1.598 0 .629-.316 1.162-.76 1.533l.024.018c.515.389.892.972.892 1.669 0 .696-.377 1.28-.892 1.668s-1.198.61-1.926.61c-1.1 0-2.143-.514-2.599-1.389a.625.625 0 0 1 1.109-.578c.187.36.728.717 1.49.717.482 0 .895-.148 1.174-.358s.394-.453.394-.67-.116-.46-.394-.67c-.28-.21-.692-.358-1.174-.358h-.461a.625.625 0 0 1 0-1.25h.357a1 1 0 0 1 .104-.01c.437 0 .81-.135 1.06-.326s.351-.41.351-.605-.101-.415-.351-.606-.623-.327-1.06-.327' },
  { type: 'heading', label: '标题 4', props: { level: 4 }, iconPath: 'M15.43 8.22c.663-.622 1.779-.162 1.779.776v3.644h.513a.625.625 0 0 1 0 1.25h-.513v1.329a.625.625 0 0 1-1.25 0v-1.33H12.75a.625.625 0 0 1-.625-.624v-.008a.55.55 0 0 1 .092-.347l3.072-4.524.01-.015.027-.039.02-.025.02-.026.012-.011zm-1.7 4.42h2.229V9.357zM10.527 4.2c.345 0 .625.28.625.625v4.94l.001.01v5.4a.626.626 0 0 1-1.25 0V10.4h-6.4v4.775a.626.626 0 0 1-1.251 0V4.825a.626.626 0 0 1 1.25 0V9.15h6.4V4.825c0-.345.28-.625.625-.625' },
  { type: 'heading', label: '标题 5', props: { level: 5 }, iconPath: 'M15.43 8.22c.663-.622 1.779-.162 1.779.776v3.644h.513a.625.625 0 0 1 0 1.25h-.513v1.329a.625.625 0 0 1-1.25 0v-1.33H12.75a.625.625 0 0 1-.625-.624v-.008a.55.55 0 0 1 .092-.347l3.072-4.524.01-.015.027-.039.02-.025.02-.026.012-.011zm-1.7 4.42h2.229V9.357zM10.527 4.2c.345 0 .625.28.625.625v4.94l.001.01v5.4a.626.626 0 0 1-1.25 0V10.4h-6.4v4.775a.626.626 0 0 1-1.251 0V4.825a.626.626 0 0 1 1.25 0V9.15h6.4V4.825c0-.345.28-.625.625-.625' },
  { type: 'heading', label: '标题 6', props: { level: 6 }, iconPath: 'M15.43 8.22c.663-.622 1.779-.162 1.779.776v3.644h.513a.625.625 0 0 1 0 1.25h-.513v1.329a.625.625 0 0 1-1.25 0v-1.33H12.75a.625.625 0 0 1-.625-.624v-.008a.55.55 0 0 1 .092-.347l3.072-4.524.01-.015.027-.039.02-.025.02-.026.012-.011zm-1.7 4.42h2.229V9.357zM10.527 4.2c.345 0 .625.28.625.625v4.94l.001.01v5.4a.626.626 0 0 1-1.25 0V10.4h-6.4v4.775a.626.626 0 0 1-1.251 0V4.825a.626.626 0 0 1 1.25 0V9.15h6.4V4.825c0-.345.28-.625.625-.625' },
  { type: 'heading', label: '折叠标题 1', props: { level: 1, isToggleable: true }, iconPath: 'M7.085 5.4a.577.577 0 1 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm11.506 3.225a.55.55 0 0 1 .064.32l.003.055v5.6a.55.55 0 1 1-1.1 0V9.815l-1.386.756a.55.55 0 1 1-.527-.966l2.2-1.2a.55.55 0 0 1 .746.22M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z' },
  { type: 'heading', label: '折叠标题 2', props: { level: 2, isToggleable: true }, iconPath: 'M7.085 5.4a.577.577 0 0 0-1.154 0v9.2a.577.577 0 1 0 1.154 0v-4.223h5.646V14.6a.577.577 0 1 0 1.154 0V5.4a.577.577 0 0 0-1.154 0v3.823H7.085zm8.955 4.588c.17-.409.645-.75 1.244-.75.793 0 1.322.559 1.322 1.106a.98.98 0 0 1-.271.667l-3.41 3.187a.55.55 0 0 0 .375.952h4a.55.55 0 1 0 0-1.1h-2.606l2.406-2.248.024-.024a2.08 2.08 0 0 0 .582-1.434c0-1.277-1.151-2.206-2.422-2.206-1 0-1.902.57-2.26 1.426a.55.55 0 1 0 1.016.424M.961 11.14c0 .455.496.735.886.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.886.5z' },
  { type: 'heading', label: '折叠标题 3', props: { level: 3, isToggleable: true }, iconPath: 'M6.508 4.823c.318 0 .577.258.577.577v3.823h5.645V5.4a.577.577 0 0 1 1.154 0v9.2a.577.577 0 1 1-1.154 0v-4.223H7.086V14.6a.577.577 0 1 1-1.154 0V5.4c0-.319.258-.577.577-.577m10.775 4.415c-.644 0-1.105.316-1.256.631a.55.55 0 1 1-.992-.474c.377-.79 1.292-1.257 2.248-1.257.626 0 1.214.193 1.657.532s.765.846.765 1.45c0 .58-.297 1.072-.715 1.41l.05.036c.468.353.81.883.81 1.514 0 .63-.342 1.16-.81 1.514-.47.354-1.093.556-1.757.556-1.005 0-1.953-.47-2.368-1.264a.55.55 0 1 1 .976-.508c.178.341.685.672 1.392.672.448 0 .833-.138 1.094-.334.26-.197.372-.427.372-.636s-.111-.44-.372-.636c-.26-.196-.646-.334-1.094-.334h-.424a.55.55 0 0 1 0-1.1h.33a1 1 0 0 1 .094-.008c.406 0 .754-.127.989-.306.234-.18.333-.388.333-.576s-.099-.397-.333-.576c-.235-.18-.583-.306-.99-.306M.962 11.14c0 .455.495.735.885.502l1.9-1.14a.585.585 0 0 0 0-1.003l-1.9-1.14a.585.585 0 0 0-.885.5z' },
  { type: 'quote', label: '引用', iconPath: 'M15.796 4.971a5.067 5.067 0 0 0-5.067 5.067v.635a4.433 4.433 0 0 0 4.433 4.433 3.164 3.164 0 1 0-3.11-3.75 3.2 3.2 0 0 1-.073-.683v-.635a3.817 3.817 0 0 1 3.817-3.817h.635a.625.625 0 1 0 0-1.25zm-9.054 0a5.067 5.067 0 0 0-5.067 5.068v.634a4.433 4.433 0 0 0 4.433 4.433 3.164 3.164 0 1 0-3.11-3.75 3.2 3.2 0 0 1-.073-.683v-.634A3.817 3.817 0 0 1 6.742 6.22h.635a.625.625 0 1 0 0-1.25z' },
  { type: 'codeBlock', label: '代码块', iconPath: 'M12.6 3.172a.625.625 0 0 0-1.201-.344l-4 14a.625.625 0 0 0 1.202.344zM5.842 5.158a.625.625 0 0 1 0 .884L1.884 10l3.958 3.958a.625.625 0 0 1-.884.884l-4.4-4.4a.625.625 0 0 1 0-.884l4.4-4.4a.625.625 0 0 1 .884 0m8.316 0a.625.625 0 0 1 .884 0l4.4 4.4a.625.625 0 0 1 0 .884l-4.4 4.4a.625.625 0 0 1-.884-.884L18.116 10l-3.958-3.958a.625.625 0 0 1 0-.884' },
  { type: 'bulletListItem', label: '无序列表', iconPath: 'M4.809 12.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M16 13.375a.625.625 0 1 1 0 1.25H8.5a.625.625 0 0 1 0-1.25zM4.809 4.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M16 5.375a.625.625 0 1 1 0 1.25H8.5a.625.625 0 0 1 0-1.25z' },
  { type: 'numberedListItem', label: '有序列表', iconPath: 'M5.088 3.026a.55.55 0 0 1 .27.474v4a.55.55 0 0 1-1.1 0V4.435l-.24.134a.55.55 0 1 1-.535-.962l1.059-.588a.55.55 0 0 1 .546.007M8.5 5.375a.625.625 0 1 0 0 1.25H16a.625.625 0 1 0 0-1.25zm0 8a.625.625 0 0 0 0 1.25H16a.625.625 0 1 0 0-1.25zM6 16.55H3.5a.55.55 0 0 1-.417-.908l1.923-2.24a.7.7 0 0 0 .166-.45.335.335 0 0 0-.266-.327l-.164-.035a.6.6 0 0 0-.245.004l-.03.007a.57.57 0 0 0-.426.44.55.55 0 1 1-1.08-.206 1.67 1.67 0 0 1 1.248-1.304l.029-.007c.24-.058.49-.061.732-.01l.164.035c.664.14 1.138.726 1.138 1.404 0 .427-.153.84-.432 1.165L4.697 15.45H6a.55.55 0 0 1 0 1.1' },
];

// Block types that are NOT convertible (custom blocks, media, etc.)
const NON_CONVERTIBLE_TYPES = new Set([
  'image', 'video', 'audio', 'file', 'table', 'divider',
  'pageReference', 'bookmark', 'subpage', 'emoji', 'page_break',
  'check_list', 'toggle_list',
]);

// Icon components for menu items — exact Notion SVG paths
const ChevronRightIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M3.5 1.5L7 5L3.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Notion "Turn into" icon (swap arrows)
const TurnIntoIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M6.475 3.125a.625.625 0 1 0 0 1.25h7.975c.65 0 1.175.526 1.175 1.175v6.057l-1.408-1.408a.625.625 0 1 0-.884.884l2.475 2.475a.625.625 0 0 0 .884 0l2.475-2.475a.625.625 0 0 0-.884-.884l-1.408 1.408V5.55a2.425 2.425 0 0 0-2.425-2.425zM3.308 6.442a.625.625 0 0 1 .884 0l2.475 2.475a.625.625 0 1 1-.884.884L4.375 8.393v6.057c0 .649.526 1.175 1.175 1.175h7.975a.625.625 0 0 1 0 1.25H5.55a2.425 2.425 0 0 1-2.425-2.425V8.393L1.717 9.801a.625.625 0 1 1-.884-.884z" />
  </svg>
);

// Notion "Color" icon (paint roller)
const ColorIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M5.606 2.669a1.55 1.55 0 0 0-1.55 1.55v.379l-.068-.004h-.694a.55.55 0 0 0 0 1.1h.694l.068-.004v.379c0 .856.694 1.55 1.55 1.55h8.788a1.55 1.55 0 0 0 1.55-1.55v-.375h.3c.207 0 .375.168.375.375v2.023a.375.375 0 0 1-.375.375h-5.319c-.815 0-1.475.66-1.475 1.475v.592a1.55 1.55 0 0 0-1.462 1.547v3.7c0 .856.694 1.55 1.55 1.55h.925a1.55 1.55 0 0 0 1.55-1.55v-3.7a1.55 1.55 0 0 0-1.463-1.547v-.592c0-.207.168-.375.375-.375h5.319c.814 0 1.475-.66 1.475-1.475V6.069c0-.815-.66-1.475-1.475-1.475h-.3v-.375a1.55 1.55 0 0 0-1.55-1.55zm-.3 1.55a.3.3 0 0 1 .3-.3h8.788a.3.3 0 0 1 .3.3v1.85a.3.3 0 0 1-.3.3H5.606a.3.3 0 0 1-.3-.3zm3.932 7.862a.3.3 0 0 1 .3-.3h.925a.3.3 0 0 1 .3.3v3.7a.3.3 0 0 1-.3.3h-.925a.3.3 0 0 1-.3-.3z" />
  </svg>
);

// Notion "Copy link" icon (chain link)
const LinkIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.61 3.61a3.776 3.776 0 0 1 5.34 0l.367.368a3.776 3.776 0 0 1 0 5.34l-1.852 1.853a.625.625 0 1 1-.884-.884l1.853-1.853a2.526 2.526 0 0 0 0-3.572l-.368-.367a2.526 2.526 0 0 0-3.572 0L9.641 6.347a.625.625 0 1 1-.883-.883z" />
    <path d="M12.98 6.949a.625.625 0 0 1 0 .884L7.53 13.28a.625.625 0 0 1-.884-.884l5.448-5.448a.625.625 0 0 1 .884 0" />
    <path d="M6.348 8.757a.625.625 0 0 1 0 .884l-1.853 1.853a2.526 2.526 0 0 0 0 3.572l.367.367a2.525 2.525 0 0 0 3.572 0l1.853-1.852a.625.625 0 1 1 .884.883l-1.853 1.853a3.776 3.776 0 0 1-5.34 0l-.367-.367a3.776 3.776 0 0 1 0-5.34l1.853-1.853a.625.625 0 0 1 .884 0" />
  </svg>
);

// Notion "Duplicate" icon (two overlapping squares)
const DuplicateIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M4.5 2.375A2.125 2.125 0 0 0 2.375 4.5V12c0 1.174.951 2.125 2.125 2.125h1.625v1.625c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125v-7.5a2.125 2.125 0 0 0-2.125-2.125h-1.625V4.5A2.125 2.125 0 0 0 12 2.375zm8.375 3.75H8.25A2.125 2.125 0 0 0 6.125 8.25v4.625H4.5A.875.875 0 0 1 3.625 12V4.5c0-.483.392-.875.875-.875H12c.483 0 .875.392.875.875zm-5.5 2.125c0-.483.392-.875.875-.875h7.5c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875z" />
  </svg>
);

// Notion "Delete" icon (trash can)
const TrashIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path d="M8.806 8.505a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0zm3.488 0a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0z" />
    <path d="M6.386 3.925v1.464H3.523a.625.625 0 1 0 0 1.25h.897l.393 8.646A2.425 2.425 0 0 0 7.236 17.6h5.528a2.425 2.425 0 0 0 2.422-2.315l.393-8.646h.898a.625.625 0 1 0 0-1.25h-2.863V3.925c0-.842-.683-1.525-1.525-1.525H7.91c-.842 0-1.524.683-1.524 1.525M7.91 3.65h4.18c.15 0 .274.123.274.275v1.464H7.636V3.925c0-.152.123-.275.274-.275m-.9 2.99h7.318l-.39 8.588a1.175 1.175 0 0 1-1.174 1.122H7.236a1.175 1.175 0 0 1-1.174-1.122l-.39-8.589z" />
  </svg>
);

// Helper: get the currently hovered block ID from the side menu
function getDragHandleBlockId(): string | null {
  const allHandles = document.querySelectorAll('[aria-label="打开菜单"]');
  for (const h of allHandles) {
    const r = h.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const wrapper = h.closest('[data-floating-ui-focusable]');
      if (!wrapper) continue;
      const wrapperRect = wrapper.getBoundingClientRect();
      const elements = document.elementsFromPoint(wrapperRect.right + 20, wrapperRect.top + 2);
      for (const el of elements) {
        const blockOuter = (el as HTMLElement).closest('.bn-block-outer');
        if (blockOuter) {
          const bc = blockOuter.querySelector('[data-node-type="blockContainer"]') || blockOuter;
          return bc.getAttribute('data-id') || blockOuter.getAttribute('data-id') || null;
        }
      }
    }
  }
  return null;
}

// Turn Into Submenu
function TurnIntoSubmenu({ onClose }: { onClose: () => void }) {
  const editor = useBlockNoteEditor();
  const blockId = getDragHandleBlockId();
  const currentBlock = blockId ? editor.document.find(b => b.id === blockId) : null;

  // Determine if current block type is convertible
  const isConvertible = currentBlock ? !NON_CONVERTIBLE_TYPES.has(currentBlock.type) : false;

  if (!isConvertible) {
    return (
      <div className="drag-handle-submenu">
        <div className="drag-handle-submenu-empty">当前块不支持转换</div>
      </div>
    );
  }

  const handleClick = (option: TurnIntoOption) => {
    if (!blockId || !currentBlock) return;
    editor.updateBlock(blockId as any, {
      type: option.type as any,
      props: option.props as any,
    });
    onClose();
  };

  // Check if an option matches the current block type
  const isCurrentType = (option: TurnIntoOption) => {
    if (!currentBlock) return false;
    if (option.type !== currentBlock.type) return false;
    if (option.props?.level !== undefined && currentBlock.props?.level !== option.props.level) return false;
    // Distinguish toggle headings from regular headings
    if (option.props?.isToggleable !== undefined) {
      const currentToggleable = (currentBlock.props as any)?.isToggleable ?? false;
      if (currentToggleable !== option.props.isToggleable) return false;
    }
    return true;
  };

  return (
    <div className="drag-handle-submenu">
      <div className="drag-handle-submenu-title">转换成</div>
      {TURN_INTO_OPTIONS.map((option, i) => (
        <div
          key={i}
          className={`drag-handle-submenu-item ${isCurrentType(option) ? 'current' : ''}`}
          onClick={() => handleClick(option)}
        >
          <span className="drag-handle-submenu-item-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d={option.iconPath} />
            </svg>
          </span>
          <span className="drag-handle-submenu-item-label">{option.label}</span>
          {isCurrentType(option) && <span className="drag-handle-check">✓</span>}
        </div>
      ))}
    </div>
  );
}

// Color Submenu
function ColorSubmenu({ onClose }: { onClose: () => void }) {
  const editor = useBlockNoteEditor();
  const blockId = getDragHandleBlockId();
  const currentBlock = blockId ? editor.document.find(b => b.id === blockId) : null;

  const currentTextColor = (currentBlock?.props as any)?.textColor || 'default';
  const currentBgColor = (currentBlock?.props as any)?.backgroundColor || 'default';

  const handleTextColor = (color: string) => {
    if (!blockId) return;
    editor.updateBlock(blockId as any, {
      type: currentBlock?.type as any,
      props: { textColor: color === 'default' ? 'default' : color } as any,
    });
    onClose();
  };

  const handleBgColor = (color: string) => {
    if (!blockId) return;
    editor.updateBlock(blockId as any, {
      type: currentBlock?.type as any,
      props: { backgroundColor: color === 'default' ? 'default' : color } as any,
    });
    onClose();
  };

  return (
    <div className="drag-handle-submenu color-submenu">
      <div className="drag-handle-submenu-title">文本颜色</div>
      <div className="color-grid">
        <div
          className={`color-swatch ${currentTextColor === 'default' ? 'active' : ''}`}
          onClick={() => handleTextColor('default')}
          title="默认"
        >
          <span className="color-swatch-letter" style={{ color: '#2c2c2b' }}>A</span>
          {currentTextColor === 'default' && <span className="drag-handle-check">✓</span>}
        </div>
        {Object.entries(COLORS).map(([name, color]) => (
          <div
            key={name}
            className={`color-swatch ${currentTextColor === name ? 'active' : ''}`}
            onClick={() => handleTextColor(name)}
            title={name}
          >
            <span className="color-swatch-letter" style={{ color: color.text }}>A</span>
            {currentTextColor === name && <span className="drag-handle-check">✓</span>}
          </div>
        ))}
      </div>
      <div className="drag-handle-submenu-title" style={{ marginTop: 8 }}>背景颜色</div>
      <div className="color-grid">
        <div
          className={`color-swatch ${currentBgColor === 'default' ? 'active' : ''}`}
          onClick={() => handleBgColor('default')}
          title="默认"
        >
          <span className="color-swatch-bg-default">A</span>
          {currentBgColor === 'default' && <span className="drag-handle-check">✓</span>}
        </div>
        {Object.entries(COLORS).map(([name, color]) => (
          <div
            key={name}
            className={`color-swatch ${currentBgColor === name ? 'active' : ''}`}
            onClick={() => handleBgColor(name)}
            title={name}
          >
            <span className="color-swatch-letter" style={{ color: '#2c2c2b', background: color.background }}>A</span>
            {currentBgColor === name && <span className="drag-handle-check">✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Main Drag Handle Menu Content
function DragHandleMenuContent({ onClose }: { onClose: () => void }) {
  const editor = useBlockNoteEditor();
  const [activeSubmenu, setActiveSubmenu] = useState<'turn-into' | 'color' | null>(null);
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSubmenuEnter = useCallback((menu: 'turn-into' | 'color') => {
    clearTimeout(submenuTimerRef.current);
    setActiveSubmenu(menu);
  }, []);

  const handleSubmenuLeave = useCallback(() => {
    submenuTimerRef.current = setTimeout(() => setActiveSubmenu(null), 150);
  }, []);

  const blockId = getDragHandleBlockId();

  const handleCopyLink = async () => {
    if (!blockId) return;
    const hash = `#block-${blockId}`;
    try {
      await navigator.clipboard.writeText(window.location.href.split('#')[0] + hash);
      showToast('已拷贝区块链接');
    } catch {
      showToast('拷贝失败');
    }
    onClose();
  };

  const handleDuplicate = () => {
    if (!blockId) return;
    const block = editor.document.find(b => b.id === blockId);
    if (!block) return;
    const blockData = {
      type: block.type,
      props: { ...block.props },
      content: block.content,
      children: block.children,
    };
    editor.insertBlocks([blockData] as any, blockId as any, 'after');
    onClose();
  };

  const handleDelete = () => {
    if (!blockId) return;
    editor.removeBlocks([blockId] as any);
    onClose();
  };

  const isConvertible = (() => {
    const currentBlock = blockId ? editor.document.find(b => b.id === blockId) : null;
    return currentBlock ? !NON_CONVERTIBLE_TYPES.has(currentBlock.type) : false;
  })();

  return (
    <div className="drag-handle-menu">
      {/* Turn into */}
      {isConvertible && (
        <div
          className="drag-handle-menu-item has-submenu"
          onMouseEnter={() => handleSubmenuEnter('turn-into')}
          onMouseLeave={handleSubmenuLeave}
          onClick={() => setActiveSubmenu(activeSubmenu === 'turn-into' ? null : 'turn-into')}
        >
          <span className="drag-handle-menu-item-icon"><TurnIntoIcon /></span>
          <span className="drag-handle-menu-item-label">转换成</span>
          <span className="drag-handle-menu-item-arrow"><ChevronRightIcon /></span>
          {activeSubmenu === 'turn-into' && (
            <TurnIntoSubmenu onClose={onClose} />
          )}
        </div>
      )}

      {/* Color */}
      <div
        className="drag-handle-menu-item has-submenu"
        onMouseEnter={() => handleSubmenuEnter('color')}
        onMouseLeave={handleSubmenuLeave}
        onClick={() => setActiveSubmenu(activeSubmenu === 'color' ? null : 'color')}
      >
        <span className="drag-handle-menu-item-icon"><ColorIcon /></span>
        <span className="drag-handle-menu-item-label">颜色</span>
        <span className="drag-handle-menu-item-arrow"><ChevronRightIcon /></span>
        {activeSubmenu === 'color' && (
          <ColorSubmenu onClose={onClose} />
        )}
      </div>

      <div className="drag-handle-menu-divider" />

      {/* Copy block link */}
      <div className="drag-handle-menu-item" onClick={handleCopyLink}>
        <span className="drag-handle-menu-item-icon"><LinkIcon /></span>
        <span className="drag-handle-menu-item-label">拷贝区块链接</span>
      </div>

      {/* Duplicate */}
      <div className="drag-handle-menu-item" onClick={handleDuplicate}>
        <span className="drag-handle-menu-item-icon"><DuplicateIcon /></span>
        <span className="drag-handle-menu-item-label">创建副本</span>
      </div>

      <div className="drag-handle-menu-divider" />

      {/* Delete */}
      <div className="drag-handle-menu-item danger" onClick={handleDelete}>
        <span className="drag-handle-menu-item-icon"><TrashIcon /></span>
        <span className="drag-handle-menu-item-label">删除</span>
      </div>
    </div>
  );
}

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
