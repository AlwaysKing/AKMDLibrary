import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SmilePlus, Search, Shuffle, Upload } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';
import { fetchIconLibrary, checkIconName, useIconFromLibrary, IconLibraryItem } from '../../api/icons';

interface PageIconProps {
  icon: string | null | undefined;
  iconLarge?: boolean;
  spaceSlug?: string;
  pageId?: string;
  compact?: boolean;
  autoOpen?: boolean;
  emojiOnly?: boolean;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onChange?: () => void;
  /** 自定义选择回调，提供时跳过内部 updateMetadata 逻辑 */
  onSelect?: (value: string) => void;
}

const EMOJI_CATEGORIES: Record<string, string[]> = {
  '常用': ['📝', '📚', '💡', '🎯', '🚀', '⭐', '🔥', '💻', '📊', '🎨', '📌', '✅', '❤️', '😊', '🎉', '👍', '💪', '🎵', '🌟', '🎁', '🏆', '👋', '🌸', '🌿', '🌊', '☀️', '🌙', '🌈', '🍀', '💎'],
  '表情': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '😮', '😯', '😲', '😳', '🥺', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
  '动物': ['🐱', '🐶', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦆', '🦅', '🦉', '🦇'],
  '自然': ['🌸', '🌺', '🌻', '🌹', '🌷', '🌱', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🌴', '🌵', '🌾', '🍄', '🌲', '🌳', '🔥', '💧', '🌊', '☔', '❄️', '⛅', '🌈', '☀️', '🌙', '⭐', '💫', '🪐'],
  '食物': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🌶️', '🌽', '🥕', '🍠', '☕', '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🍷'],
  '运动': ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🏒', '⛳', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹', '⛸️', '🥌', '🎿', '🏂', '🏋️', '🤸', '⛹️', '🤺', '🤾', '🏇', '🧘', '🏄', '🏊'],
  '交通': ['🚗', '🚕', '🚌', '🏎️', '🚑', '🚒', '🚐', '🚚', '🏍️', '🛵', '🚲', '🛴', '🚃', '🚋', '🚄', '🚅', '🚂', '✈️', '🛫', '🛬', '🚁', '🛸', '🚀', '⛵', '🚢', '🗺️', '🧭', '🏔️', '⛰️', '🌋'],
  '建筑': ['🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '⛩️', '🕋', '🏟️', '🏛️', '🏗️'],
  '物品': ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '🎥', '📺', '📻', '💾', '💿', '🔋', '🔌', '💡', '🔦', '🕯️', '📚', '📖', '🔖', '📎', '📌', '📍', '✂️', '✏️', '📝', '🔍', '🔒', '🔑', '🔧'],
  '符号': ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '✔️', '✖️', '❓', '❗', '💯', '⚠️', '♻️', '✅', '❌', '➕', '➖', '➗', '♾️'],
};

const CATEGORY_ICONS = [
  { key: '自定义', icon: '🖼️' },
  { key: '常用', icon: '🕐' },
  { key: '表情', icon: '😀' },
  { key: '动物', icon: '🐶' },
  { key: '自然', icon: '🌿' },
  { key: '食物', icon: '🍔' },
  { key: '运动', icon: '⚽' },
  { key: '交通', icon: '🚗' },
  { key: '建筑', icon: '🏠' },
  { key: '物品', icon: '💡' },
  { key: '符号', icon: '🔴' },
];

export default function PageIcon({ icon, iconLarge, spaceSlug, pageId, compact, autoOpen, emojiOnly, triggerClassName, onOpenChange, onChange, onSelect }: PageIconProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [search, setSearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [addToLibrary, setAddToLibrary] = useState(false);
  const [iconName, setIconName] = useState('');
  const [iconNameError, setIconNameError] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [customIcons, setCustomIcons] = useState<IconLibraryItem[]>([]);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const { updateMetadata } = usePageStore();

  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);

  // Anchor: the bottom edge of the picker should always sit at triggerRect.top - gap
  // When content height changes, only the top moves — bottom stays pinned.
  const updatePopupPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pickerWidth = 408;
    const gap = 4;

    // Horizontal: center on trigger, but clamp to viewport
    let left = rect.left + rect.width / 2 - pickerWidth / 2;
    if (left < 8) left = 8;
    if (left + pickerWidth > window.innerWidth - 8) left = window.innerWidth - pickerWidth - 8;

    const actualHeight = pickerRef.current?.offsetHeight ?? 0;
    const height = actualHeight > 0 ? actualHeight : 420;

    // Prefer below, fallback above
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    if (spaceBelow >= height) {
      setPopupStyle({
        position: 'fixed',
        left,
        top: rect.bottom + gap,
        width: `${pickerWidth}px`,
      });
    } else {
      let top = rect.top - gap - height;
      if (top < 8) top = 8;
      setPopupStyle({
        position: 'fixed',
        left,
        top,
        width: `${pickerWidth}px`,
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePopupPosition();
      // Re-calculate after DOM renders to use actual picker height
      requestAnimationFrame(() => updatePopupPosition());
    }
  }, [isOpen, updatePopupPosition]);

  // Re-position when tab changes (emoji vs upload have different heights)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => updatePopupPosition());
    }
  }, [isOpen, tab, updatePopupPosition]);

  // Load icon library when picker opens
  useEffect(() => {
    if (isOpen && !emojiOnly) {
      fetchIconLibrary().then(setCustomIcons).catch(() => {});
    }
  }, [emojiOnly, isOpen]);

  const allEmojis = useMemo(() => {
    return Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => ({ category, emojis }));
  }, []);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const query = search.toLowerCase();
    const flat = Object.values(EMOJI_CATEGORIES).flat();
    return [...new Set(flat)].filter(e => e.includes(query));
  }, [search]);

  const scrollToCategory = (cat: string) => {
    const el = categoryRefs.current[cat];
    if (el && gridRef.current) {
      gridRef.current.scrollTo({ top: el.offsetTop - gridRef.current.offsetTop - 8, behavior: 'smooth' });
    }
  };

  const handleSelectEmoji = async (emoji: string) => {
    if (onSelect) {
      onSelect(emoji);
      setOpen(false);
      setSearch('');
      return;
    }
    await updateMetadata(spaceSlug!, pageId!, { icon: emoji, icon_large: false });
    onChange?.();
    setOpen(false);
    setSearch('');
  };

  const handleSelectCustomIcon = async (item: IconLibraryItem) => {
    try {
      const assetPath = await useIconFromLibrary(item.name, pageId, spaceSlug);
      const iconUrl = `/api/spaces/${spaceSlug}/pages/${pageId}/assets/${assetPath}`;
      await updateMetadata(spaceSlug, pageId, { icon: iconUrl });
      onChange?.();
    } catch (e) {
      console.error('Failed to use icon from library:', e);
    }
    setOpen(false);
  };

  const handleRemove = async () => {
    if (onSelect) {
      onSelect('');
      setOpen(false);
      return;
    }
    await updateMetadata(spaceSlug!, pageId!, { icon: '' });
    onChange?.();
    setOpen(false);
  };

  const handleRandom = async () => {
    const all = Object.values(EMOJI_CATEGORIES).flat();
    const randomEmoji = all[Math.floor(Math.random() * all.length)];
    if (onSelect) {
      onSelect(randomEmoji);
      setOpen(false);
      return;
    }
    await updateMetadata(spaceSlug!, pageId!, { icon: randomEmoji });
    onChange?.();
    setOpen(false);
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_id', pageId);
      formData.append('space_slug', spaceSlug);
      if (addToLibrary) {
        formData.append('add_to_library', 'true');
        const name = iconName.trim() || pendingFile!.name.replace(/\.[^.]+$/, '');
        formData.append('icon_name', name);
      }

      const xhr = new XMLHttpRequest();
      const uploadPromise = new Promise<{ path: string }>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error('Upload failed'));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('POST', '/api/upload');
        xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);
        xhr.send(formData);
      });

      const data = await uploadPromise;
      // 后端 /api/upload 已返回完整 URL（/api/spaces/.../assets/{uuid}/file），不要重复拼接
      await updateMetadata(spaceSlug, pageId, { icon: data.path });
      onChange?.();
      setOpen(false);
    } catch (error) {
      console.error('Failed to upload icon:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setPendingFile(file);
      setPendingPreview(URL.createObjectURL(file));
      setIconName(file.name.replace(/\.[^.]+$/, ''));
      setIconNameError(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setPendingFile(file);
      setPendingPreview(URL.createObjectURL(file));
      setIconName(file.name.replace(/\.[^.]+$/, ''));
      setIconNameError(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleIconNameBlur = async () => {
    if (addToLibrary && iconName.trim()) {
      const exists = await checkIconName(iconName.trim());
      setIconNameError(exists);
    }
  };

  const handleConfirmUpload = () => {
    if (pendingFile) {
      handleFileUpload(pendingFile);
    }
  };

  const handleCancelUpload = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setIconName('');
    setIconNameError(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Check if icon is a URL (uploaded image)
  const isIconUrl = icon?.startsWith('/') || icon?.startsWith('http');

  const handleToggleLarge = async () => {
    await updateMetadata(spaceSlug, pageId, { icon_large: !iconLarge });
  };

  // Display size: large when toggle is on and icon is an image
  const isLarge = iconLarge && isIconUrl;
  const displaySize = isLarge ? 125 : 78;

  // Shared picker portal content
  const pickerPortal = isOpen && createPortal(
    <>
      <div className={`fixed inset-0 ${compact ? 'z-[60]' : 'z-40'}`} onClick={() => { setOpen(false); setSearch(''); }} />
      <div ref={pickerRef} className={`fixed bg-white border border-notion-border rounded-[10px] shadow-lg overflow-hidden ${compact ? 'z-[70]' : 'z-50'}`} style={popupStyle}>
        {/* Header: tabs + remove */}
        <div className="flex items-center justify-between px-1 pt-1 border-b border-notion-border">
          <div className="flex">
            <button
              onClick={() => setTab('emoji')}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === 'emoji' ? 'text-notion-text border-notion-text' : 'text-notion-textSecondary border-transparent hover:text-notion-text'
              }`}
            >
              表情符号
            </button>
            {!emojiOnly && (
              <button
                onClick={() => setTab('upload')}
                className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  tab === 'upload' ? 'text-notion-text border-notion-text' : 'text-notion-textSecondary border-transparent hover:text-notion-text'
                }`}
              >
                上传
              </button>
            )}
          </div>
          {icon && (
            <div className="flex items-center gap-1">
              <label className={`flex items-center gap-1.5 select-none ${!isIconUrl ? 'opacity-30 pointer-events-none' : 'cursor-pointer'}`}>
                <span className="text-xs text-notion-textSecondary">大图标</span>
                <button
                  role="switch"
                  aria-checked={!!iconLarge}
                  onClick={handleToggleLarge}
                  disabled={!isIconUrl}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    iconLarge ? 'bg-blue-500' : 'bg-notion-border'
                  }`}
                >
                  <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${iconLarge ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
              </label>
              <button
                onClick={handleRemove}
                className="px-2 py-1 text-xs text-notion-textSecondary hover:text-red-500 transition-colors"
              >
                移除
              </button>
            </div>
          )}
        </div>

        {tab === 'emoji' && (
          <>
            {/* Search + Random */}
            <div className="px-2 py-1.5 flex items-center gap-1.5">
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-notion-textSecondary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="筛选…"
                  className="w-full pl-7 pr-2 py-1.5 text-sm bg-notion-sidebarBg rounded-md outline-none focus:ring-1 focus:ring-notion-border"
                />
              </div>
              <button
                onClick={handleRandom}
                className="p-1.5 text-notion-textSecondary hover:bg-notion-hover rounded-md transition-colors"
                title="随机"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>

            <div className="border-t border-notion-border" />

            {/* Emoji grid — custom icons + all categories, scrollable */}
            <div ref={gridRef} className="p-2 overflow-y-auto" style={{ height: '280px' }}>
              {searchResults ? (
                <div className="flex flex-wrap gap-[2px]">
                  {searchResults.map((emoji, i) => (
                    <button
                      key={`${emoji}-${i}`}
                      onClick={() => handleSelectEmoji(emoji)}
                      className="w-8 h-8 text-xl hover:bg-notion-hover rounded-md flex items-center justify-center transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {!emojiOnly && (
                    <div
                      ref={(el) => { categoryRefs.current['自定义'] = el; }}
                      className="mb-2"
                    >
                      <p className="text-xs font-medium text-notion-textSecondary mb-1 px-1">自定义</p>
                      {customIcons.length > 0 ? (
                        <div className="flex flex-wrap gap-[2px]">
                          {customIcons.map((item) => (
                            <button
                              key={item.name}
                              onClick={() => handleSelectCustomIcon(item)}
                              className="w-8 h-8 hover:bg-notion-hover rounded-md flex items-center justify-center transition-colors overflow-hidden"
                            >
                              <img src={item.url} alt="" className="w-6 h-6 object-contain" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-notion-textSecondary px-1 py-1">暂无自定义图标，上传时可添加到图标库</p>
                      )}
                    </div>
                  )}

                  {/* Emoji categories */}
                  {allEmojis.map(({ category, emojis }) => (
                    <div
                      key={category}
                      ref={(el) => { categoryRefs.current[category] = el; }}
                      className="mb-2"
                    >
                      <p className="text-xs font-medium text-notion-textSecondary mb-1 px-1">{category}</p>
                      <div className="flex flex-wrap gap-[2px]">
                        {emojis.map((emoji, i) => (
                          <button
                            key={`${emoji}-${i}`}
                            onClick={() => handleSelectEmoji(emoji)}
                            className="w-8 h-8 text-xl hover:bg-notion-hover rounded-md flex items-center justify-center transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Bottom category icons — scroll anchors */}
            <div className="border-t border-notion-border px-2 py-1.5 flex items-center gap-0.5">
              {CATEGORY_ICONS.filter(({ key }) => !emojiOnly || key !== '自定义').map(({ key, icon: catIcon }) => (
                <button
                  key={key}
                  onClick={() => scrollToCategory(key)}
                  className="w-8 h-8 text-base rounded-md flex items-center justify-center transition-colors hover:bg-notion-hover"
                  title={key}
                >
                  {catIcon}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'upload' && (
          <div className="p-3">
            {pendingPreview ? (
              <>
                {/* Preview */}
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-[78px] h-[78px] flex items-center justify-center">
                    <img src={pendingPreview} alt="" className="w-[78px] h-[78px] object-contain rounded-lg" />
                  </div>
                </div>
                <div className="border-t border-notion-border my-2" />
                {/* Add to library checkbox */}
                <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    checked={addToLibrary}
                    onChange={(e) => { setAddToLibrary(e.target.checked); if (!e.target.checked) setIconNameError(false); }}
                    className="w-3.5 h-3.5 rounded border-notion-border text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-xs text-notion-textSecondary">添加到图标库</span>
                </label>
                {/* Icon name input when library is checked */}
                {addToLibrary && (
                  <div className="mb-3">
                    <p className="text-xs text-notion-textSecondary mb-1">图标名称</p>
                    <input
                      type="text"
                      value={iconName}
                      onChange={(e) => { setIconName(e.target.value); setIconNameError(false); }}
                      onBlur={handleIconNameBlur}
                      placeholder="为图标命名"
                      className={`w-full px-2 py-1.5 text-xs rounded-md outline-none border ${
                        iconNameError
                          ? 'border-red-400 focus:ring-1 focus:ring-red-400'
                          : 'border-notion-border focus:ring-1 focus:ring-blue-400'
                      }`}
                    />
                    {iconNameError && (
                      <p className="text-[10px] text-red-500 mt-1">该名称已存在</p>
                    )}
                  </div>
                )}
                {/* Confirm / Cancel */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConfirmUpload}
                    disabled={isUploading || (addToLibrary && iconNameError)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors disabled:opacity-50"
                  >
                    {isUploading ? '上传中…' : '确定'}
                  </button>
                  <button
                    onClick={handleCancelUpload}
                    disabled={isUploading}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-notion-text bg-notion-sidebarBg hover:bg-notion-hover rounded-md transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Upload drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`w-full border border-dashed rounded-md py-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-400 bg-blue-50 text-blue-500'
                      : 'border-notion-border text-notion-textSecondary hover:bg-notion-hover'
                  }`}
                >
                  <Upload className="w-5 h-5" />
                  <span className="text-xs">点击或拖拽文件上传</span>
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        )}
      </div>
    </>,
    document.body
  );

  // Compact mode: small trigger for inline use (e.g. rename panel)
  if (compact) {
    return (
      <div className="relative inline-block">
        <button
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
          className={`flex items-center justify-center w-7 h-7 rounded border border-transparent hover:border-notion-border transition-colors${triggerClassName ? ` ${triggerClassName}` : ''}`}
        >
          {icon ? (
            isIconUrl ? (
              <img src={icon} alt="" className="w-[18px] h-[18px] object-contain" />
            ) : (
              <span className="text-[18px] leading-none" style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"' }}>{icon}</span>
            )
          ) : (
            <SmilePlus className="w-4 h-4 text-notion-textSecondary" />
          )}
        </button>
        {pickerPortal}
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      {!icon ? (
        <button
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-2 py-0.5 text-sm text-notion-textSecondary hover:bg-notion-hover rounded transition-colors"
        >
          <SmilePlus className="w-3.5 h-3.5" />
          添加图标
        </button>
      ) : (
        <button
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          onClick={() => setOpen(true)}
          className=""
          style={{ width: `${displaySize}px`, height: `${displaySize}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {isIconUrl ? (
            <img src={icon} alt="" style={{ width: `${displaySize}px`, height: `${displaySize}px`, objectFit: isLarge ? 'cover' : 'contain' }} className="rounded-lg" />
          ) : (
            <span className="text-[78px] leading-none">{icon}</span>
          )}
        </button>
      )}
      {pickerPortal}
    </div>
  );
}
