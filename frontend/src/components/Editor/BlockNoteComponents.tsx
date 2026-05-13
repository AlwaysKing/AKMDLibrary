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
  ComponentType,
  ReactNode,
} from 'react';
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

function setBlockSelection(blockId: string | null) {
  if (!blockSelectionStyleEl) {
    blockSelectionStyleEl = document.createElement('style');
    blockSelectionStyleEl.id = 'block-selection-style';
    document.head.appendChild(blockSelectionStyleEl);
  }
  if (blockId) {
    // Notion: selection halo uses inset:2px overlay, rgba(35,131,226,0.14), border-radius 4px
    blockSelectionStyleEl.textContent = `
      .bn-block-outer:has(> [data-id="${blockId}"]) {
        position: relative;
      }
      .bn-block-outer:has(> [data-id="${blockId}"])::after {
        content: '';
        position: absolute;
        inset: 2px;
        background: rgba(35, 131, 226, 0.14);
        border-radius: 4px;
        pointer-events: none;
      }
    `;
  } else {
    blockSelectionStyleEl.textContent = '';
  }
}

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

      // 延迟到 BlockNote/ProseMirror 重渲染完成后再应用样式
      setTimeout(() => {
        setBlockSelection(targetBlockId);
      }, 100);
    };

    btn.addEventListener('click', handleNativeClick);
    return () => btn.removeEventListener('click', handleNativeClick);
  }, [draggable]);

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
  const { className, children } = props;
  const { isOpen, setOpen, position } = useContext(MenuContext);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside dropdown or on the trigger button
      if (dropdownRef.current?.contains(target)) return;
      // Check if clicking on a side menu button (the trigger)
      const sideMenu = document.querySelector('.bn-side-menu');
      if (sideMenu?.contains(target)) return;
      setOpen(false);
    };

    // Use setTimeout to avoid the current click event
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setOpen]);

  // Handle escape key
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

  return (
    <div
      ref={(node) => {
        (dropdownRef as any).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as any).current = node;
      }}
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
const SuggestionMenuRoot: React.FC<{
  id?: string;
  className?: string;
  children?: ReactNode;
}> = (props) => {
  const { id, className, children } = props;
  return (
    <div id={id} className={className}>
      {children}
    </div>
  );
};

const SuggestionMenuItem: React.FC<{
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
      <span>{item.title || item.name}</span>
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
