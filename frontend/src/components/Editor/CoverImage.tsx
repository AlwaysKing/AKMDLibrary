import { useState, useRef, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Check, Upload, Grid3X3, Search, Download, User } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';
import { usePreferenceStore } from '../../stores/preferenceStore';
import { fetchCoverLibrary, checkCoverName, useCoverFromLibrary, CoverLibraryItem } from '../../api/covers';
import apiClient from '../../api/client';

// 图库分类数据（参考 Notion 封面图库分类）
// 图片内置在 frontend/public/covers/，避免运行时依赖 Unsplash CDN
const GALLERY_CATEGORIES = [
  {
    id: 'gradient',
    label: '渐变',
    items: [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
      'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
      'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
      'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
      'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
      'linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)',
    ],
  },
  {
    id: 'nature',
    label: '自然',
    items: Array.from({ length: 10 }, (_, i) => `/covers/nature/nature-${String(i + 1).padStart(2, '0')}.jpg`),
  },
  {
    id: 'architecture',
    label: '建筑',
    items: Array.from({ length: 10 }, (_, i) => `/covers/architecture/architecture-${String(i + 1).padStart(2, '0')}.jpg`),
  },
  {
    id: 'space',
    label: '太空',
    items: Array.from({ length: 10 }, (_, i) => `/covers/space/space-${String(i + 1).padStart(2, '0')}.jpg`),
  },
  {
    id: 'art',
    label: '艺术',
    items: Array.from({ length: 10 }, (_, i) => `/covers/art/art-${String(i + 1).padStart(2, '0')}.jpg`),
  },
  {
    id: 'abstract',
    label: '抽象',
    items: Array.from({ length: 8 }, (_, i) => `/covers/abstract/abstract-${String(i + 1).padStart(2, '0')}.jpg`),
  },
];

// 缩略图映射：渐变返回 null（用 CSS 渲染），其他用原图（浏览器缩放）
const getThumbUrl = (url: string) => {
  if (url.startsWith('linear-gradient')) return null;
  return url;
};

interface CoverImageProps {
  coverUrl: string | null | undefined;
  coverOffset?: number;
  spaceSlug: string;
  pageId: string;
}

export default function CoverImage({ coverUrl, coverOffset: savedOffset, spaceSlug, pageId }: CoverImageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<'gallery' | 'upload' | 'link' | 'unsplash'>('gallery');
  const [galleryCategory, setGalleryCategory] = useState('custom');
  const [linkUrl, setLinkUrl] = useState('');
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [coverOffset, setCoverOffset] = useState(savedOffset ?? 50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedOffsetRef = useRef(savedOffset);

  // Sync coverOffset when savedOffset prop changes externally (e.g. after API save)
  useEffect(() => {
    if (savedOffset !== savedOffsetRef.current) {
      savedOffsetRef.current = savedOffset;
      setCoverOffset(savedOffset ?? 50);
    }
  }, [savedOffset]);
  const { updateMetadata } = usePageStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const coverRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const isDraggingCover = useRef(false);

  // Unsplash search state
  const [unsplashQuery, setUnsplashQuery] = useState('');
  const [unsplashResults, setUnsplashResults] = useState<Array<{ id: string; url: string; thumb: string; author: string }>>([]);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashLoadingMore, setUnsplashLoadingMore] = useState(false);
  const [unsplashHasMore, setUnsplashHasMore] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // 请求序列号：query 改变时 ++，旧请求回来时如果 seq 不匹配就丢弃结果（防 race condition）
  const unsplashSeqRef = useRef(0);
  // 当前 query 和 page 用 ref 跟踪，避免闭包陈旧
  const unsplashQueryRef = useRef('');
  const unsplashPageRef = useRef(1);
  const unsplashTotalRef = useRef(0);

  // Cover library state
  const [coverLibrary, setCoverLibrary] = useState<CoverLibraryItem[]>([]);
  const [addToCoverLibrary, setAddToCoverLibrary] = useState(false);
  const [coverName, setCoverName] = useState('');
  const [coverNameError, setCoverNameError] = useState(false);

  // Upload preview state (same pattern as PageIcon)
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Load cover library when picker opens
  useEffect(() => {
    if (showPicker) {
      fetchCoverLibrary().then(setCoverLibrary).catch(() => {});
    }
  }, [showPicker]);

  const handleCoverNameBlur = useCallback(async () => {
    if (addToCoverLibrary && coverName.trim()) {
      const exists = await checkCoverName(coverName.trim());
      setCoverNameError(exists);
    }
  }, [addToCoverLibrary, coverName]);

  const handleSelectFromLibrary = async (item: CoverLibraryItem) => {
    try {
      const assetPath = await useCoverFromLibrary(item.name, pageId, spaceSlug);
      const newCoverUrl = `/api/spaces/${spaceSlug}/pages/${pageId}/assets/${assetPath}`;
      await updateMetadata(spaceSlug, pageId, { cover_url: newCoverUrl });
    } catch (e) {
      console.error('Failed to use cover from library:', e);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_id', pageId);
      formData.append('space_slug', spaceSlug);

      // Add to cover library if checked
      if (addToCoverLibrary) {
        formData.append('add_to_cover_library', 'true');
        const name = coverName.trim() || file.name.replace(/\.[^.]+$/, '');
        formData.append('cover_name', name);
      }

      const xhr = new XMLHttpRequest();
      const uploadPromise = new Promise<{ path: string }>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
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
      await updateMetadata(spaceSlug, pageId, { cover_url: data.path });
      setShowPicker(false);
    } catch (error) {
      console.error('Failed to upload cover:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // File input change — show preview first
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setPendingFile(file);
      setPendingPreview(URL.createObjectURL(file));
      setCoverName(file.name.replace(/\.[^.]+$/, ''));
      setCoverNameError(false);
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
      setCoverName(file.name.replace(/\.[^.]+$/, ''));
      setCoverNameError(false);
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

  const handleConfirmUpload = () => {
    if (pendingFile) {
      handleFileUpload(pendingFile);
    }
  };

  const handleCancelUpload = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setCoverName('');
    setCoverNameError(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSelectPreset = async (preset: string) => {
    if (preset.startsWith('linear-gradient')) {
      // 渐变是 CSS 字符串，直接存（无需复制）
      await updateMetadata(spaceSlug, pageId, { cover_url: preset });
      setShowPicker(false);
    } else {
      // 本地图片：fetch blob → 走上传流程（后端自动复制到 page 的 public/{uuid}/）
      try {
        const res = await fetch(preset);
        const blob = await res.blob();
        const filename = preset.split('/').pop() || 'cover.jpg';
        const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
        await handleFileUpload(file);
      } catch (e) {
        console.error('Failed to apply preset cover:', e);
      }
    }
  };

  // 「添加封面」按钮：从所有内置项里随机抽一个（12 渐变 + 48 图片 = 60 个）
  const handleAddRandomCover = () => {
    const allItems = GALLERY_CATEGORIES.flatMap(c => c.items);
    const pick = allItems[Math.floor(Math.random() * allItems.length)];
    handleSelectPreset(pick);
  };

  const handleSelectUnsplash = async (url: string) => {
    await updateMetadata(spaceSlug, pageId, { cover_url: url });
  };

  const handleRemove = async () => {
    await updateMetadata(spaceSlug, pageId, { cover_url: '' });
    setShowPicker(false);
    setIsHovered(false);
  };

  // Unsplash search：走后端代理（key 保存在 DB，不在前端暴露）
  // 新搜索：重置 page=1，覆盖结果
  const searchUnsplash = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      unsplashSeqRef.current++;
      unsplashQueryRef.current = '';
      setUnsplashResults([]);
      setUnsplashHasMore(false);
      return;
    }
    // 新 query → 序列号 +1，旧请求回来时 seq 不匹配会被丢弃
    const seq = ++unsplashSeqRef.current;
    unsplashQueryRef.current = trimmed;
    unsplashPageRef.current = 1;
    setUnsplashLoading(true);
    try {
      const res = await apiClient.get('/unsplash/search', {
        params: { q: trimmed, per_page: 12, page: 1 },
      });
      if (seq !== unsplashSeqRef.current) return;  // 请求过期，丢弃
      const data = res.data as { total?: number; total_pages?: number; results?: Array<{ id: string; urls: { raw: string; thumb: string }; user: { name: string } }> };
      unsplashTotalRef.current = data.total ?? 0;
      const items = (data.results || []).map((photo) => ({
        id: photo.id,
        url: photo.urls.raw + '&w=1200&h=400&fit=crop',
        thumb: photo.urls.thumb,
        author: photo.user.name,
      }));
      setUnsplashResults(items);
      setUnsplashHasMore((data.total_pages ?? 1) > 1 && items.length > 0);
    } catch (error) {
      console.error('Unsplash search error:', error);
      if (seq === unsplashSeqRef.current) {
        setUnsplashResults([]);
        setUnsplashHasMore(false);
      }
    } finally {
      if (seq === unsplashSeqRef.current) setUnsplashLoading(false);
    }
  }, []);

  // 加载下一页：append 结果
  const loadMoreUnsplash = useCallback(async () => {
    const query = unsplashQueryRef.current;
    if (!query || unsplashLoadingMore || !unsplashHasMore) return;
    const nextPage = unsplashPageRef.current + 1;
    // 加载更多不 ++seq（因为不算新 query），但用 loading 状态防止并发
    setUnsplashLoadingMore(true);
    try {
      const res = await apiClient.get('/unsplash/search', {
        params: { q: query, per_page: 12, page: nextPage },
      });
      // 如果用户在此期间又搜索了新 query，丢弃这次结果
      if (query !== unsplashQueryRef.current) return;
      const data = res.data as { total_pages?: number; results?: Array<{ id: string; urls: { raw: string; thumb: string }; user: { name: string } }> };
      const items = (data.results || []).map((photo) => ({
        id: photo.id,
        url: photo.urls.raw + '&w=1200&h=400&fit=crop',
        thumb: photo.urls.thumb,
        author: photo.user.name,
      }));
      unsplashPageRef.current = nextPage;
      setUnsplashResults(prev => {
        // 去重：避免同一张图被加两次（理论上不会，但保险起见）
        const existingIds = new Set(prev.map(p => p.id));
        return [...prev, ...items.filter(p => !existingIds.has(p.id))];
      });
      setUnsplashHasMore((data.total_pages ?? nextPage) > nextPage);
    } catch (error) {
      console.error('Unsplash load more error:', error);
    } finally {
      setUnsplashLoadingMore(false);
    }
  }, [unsplashLoadingMore, unsplashHasMore]);

  const handleUnsplashQueryChange = (value: string) => {
    setUnsplashQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchUnsplash(value), 500);
  };

  const enterReposition = useCallback(() => {
    setIsRepositioning(true);
    isDraggingCover.current = false;
    dragStartOffset.current = coverOffset;
  }, [coverOffset]);

  const exitReposition = useCallback(async () => {
    await updateMetadata(spaceSlug, pageId, { cover_offset: Math.round(coverOffset) });
    setIsRepositioning(false);
  }, [coverOffset, spaceSlug, pageId, updateMetadata]);

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (pickerRef.current?.contains(target)) return;
      if (target.closest('.cover-action-btn')) return;
      setShowPicker(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPicker]);

  // Reposition mode
  useEffect(() => {
    if (!isRepositioning) return;

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      isDraggingCover.current = true;
      dragStartY.current = e.clientY;
      dragStartOffset.current = coverOffset;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingCover.current) return;
      const cover = coverRef.current;
      if (!cover) return;
      const coverHeight = cover.offsetHeight;
      const delta = e.clientY - dragStartY.current;
      const percentDelta = -(delta / coverHeight) * 100;
      const newOffset = Math.max(0, Math.min(100, dragStartOffset.current + percentDelta));
      setCoverOffset(newOffset);
    };

    const handleMouseUp = () => { isDraggingCover.current = false; };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitReposition();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRepositioning, coverOffset, exitReposition]);

  const isGradient = coverUrl?.startsWith('linear-gradient');
  const coverBgStyle = isGradient
    ? { background: coverUrl }
    : { backgroundImage: `url(${coverUrl})`, backgroundPosition: `center ${coverOffset}%` };

  // 只在用户配置了 Unsplash API key 时才显示 Unsplash tab
  const hasUnsplashKey = usePreferenceStore(s => !!s.preferences.has_unsplash_key);
  const tabsList = [
    { key: 'gallery' as const, label: '图库', Icon: Grid3X3 },
    { key: 'upload' as const, label: '上传', Icon: Upload },
    { key: 'link' as const, label: '链接', Icon: ImageIcon },
    ...(hasUnsplashKey ? [{ key: 'unsplash' as const, label: 'Unsplash', Icon: Search }] : []),
  ];

  if (!coverUrl) {
    return (
      <div className="relative group">
        <button
          onClick={handleAddRandomCover}
          className="flex items-center gap-1 px-2 py-0.5 text-sm text-notion-textSecondary hover:bg-notion-hover rounded transition-colors"
        >
          <ImageIcon className="w-4 h-4" />
          添加封面
        </button>
      </div>
    );
  }

  const currentCategory = GALLERY_CATEGORIES.find(c => c.id === galleryCategory);

  return (
    <div
      ref={coverRef}
      className={`relative h-[30vh] max-h-[280px] bg-cover group ${isRepositioning ? 'cursor-ns-resize' : ''}`}
      style={coverBgStyle}
      onMouseEnter={() => { if (!isRepositioning) setIsHovered(true); }}
      onMouseLeave={() => { if (!isRepositioning && !showPicker) setIsHovered(false); }}
    >
      {/* Buttons */}
      {(isHovered || isRepositioning) && (
        <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
          {isRepositioning ? (
            <button
              onClick={exitReposition}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-xs text-notion-text transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              完成
            </button>
          ) : (
            <div className="cover-action-btn flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden z-20">
              <button
                className="px-3 py-1.5 text-xs text-notion-text hover:bg-gray-50 transition-colors border-r border-gray-200"
                onClick={() => { setShowPicker(!showPicker); setPickerTab('gallery'); }}
              >
                更改
              </button>
              <button
                className="px-3 py-1.5 text-xs text-notion-text hover:bg-gray-50 transition-colors border-r border-gray-200"
                onClick={enterReposition}
              >
                调整位置
              </button>
              <a
                href={coverUrl && !isGradient ? coverUrl : undefined}
                download={coverUrl && !isGradient ? true : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center w-8 h-8 text-notion-text transition-colors ${
                  coverUrl && !isGradient ? 'hover:bg-gray-50' : 'opacity-40 cursor-default'
                }`}
                onClick={(e) => { if (isGradient || !coverUrl) e.preventDefault(); }}
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Cover picker panel */}
      {showPicker && (
        <div
          ref={pickerRef}
          className="absolute top-12 right-3 w-[540px] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30"
        >
          {/* Tabs */}
          <div className="flex items-center border-b border-gray-100">
            <div className="flex">
              {tabsList.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setPickerTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
                    pickerTab === key
                      ? 'text-notion-text border-b-2 border-notion-text'
                      : 'text-notion-textSecondary hover:text-notion-text'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto pr-2">
              <button
                onClick={handleRemove}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                移除
              </button>
            </div>
          </div>

          {/* Tab content */}
          <div
            className="max-h-[300px] overflow-y-auto"
            onScroll={(e) => {
              if (pickerTab !== 'unsplash') return;
              const el = e.currentTarget;
              // 距离底部 < 80px 就触发加载
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
                loadMoreUnsplash();
              }
            }}
          >
            {pickerTab === 'gallery' && (
              <>
                {/* Category tabs */}
                <div className="flex gap-1 px-3 pt-3 pb-2">
                  <button
                    onClick={() => setGalleryCategory('custom')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                      galleryCategory === 'custom'
                        ? 'bg-notion-hover text-notion-text font-medium'
                        : 'text-notion-textSecondary hover:bg-notion-hover'
                    }`}
                  >
                    <User className="w-3 h-3" />
                    自定义
                  </button>
                  {GALLERY_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setGalleryCategory(cat.id)}
                      className={`px-2.5 py-1 rounded text-xs transition-colors ${
                        galleryCategory === cat.id
                          ? 'bg-notion-hover text-notion-text font-medium'
                          : 'text-notion-textSecondary hover:bg-notion-hover'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                {/* Category items */}
                <div className="px-3 pb-3">
                  {galleryCategory === 'custom' ? (
                    coverLibrary.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {coverLibrary.map((item) => (
                          <button
                            key={item.name}
                            onClick={() => handleSelectFromLibrary(item)}
                            className="h-20 rounded hover:ring-2 hover:ring-blue-400 transition-all overflow-hidden relative group/lib"
                          >
                            <img src={item.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] text-white bg-black/50 opacity-0 group-hover/lib:opacity-100 transition-opacity truncate">
                              {item.name.replace(/\.[^.]+$/, '')}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-sm text-gray-400 py-4">暂无自定义封面，上传时可添加到封面库</p>
                    )
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {currentCategory?.items.map((item, i) => {
                        const thumbUrl = getThumbUrl(item);
                        return (
                          <button
                            key={i}
                            onClick={() => handleSelectPreset(item)}
                            className="h-14 rounded hover:ring-2 hover:ring-blue-400 transition-all overflow-hidden"
                            style={thumbUrl ? {} : { background: item }}
                          >
                            {thumbUrl && (
                              <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {pickerTab === 'upload' && (
              <div className="p-3">
                {pendingPreview ? (
                  <>
                    {/* Preview */}
                    <div className="rounded-lg overflow-hidden mb-3">
                      <img src={pendingPreview} alt="" className="w-full h-32 object-cover" />
                    </div>
                    <div className="border-t border-notion-border my-2" />
                    {/* Add to cover library checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                      <input
                        type="checkbox"
                        checked={addToCoverLibrary}
                        onChange={(e) => { setAddToCoverLibrary(e.target.checked); if (!e.target.checked) setCoverNameError(false); }}
                        className="w-3.5 h-3.5 rounded border-notion-border text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-xs text-notion-textSecondary">添加到封面库</span>
                    </label>
                    {/* Cover name input when library is checked */}
                    {addToCoverLibrary && (
                      <div className="mb-3">
                        <p className="text-xs text-notion-textSecondary mb-1">封面名称</p>
                        <input
                          type="text"
                          value={coverName}
                          onChange={(e) => { setCoverName(e.target.value); setCoverNameError(false); }}
                          onBlur={handleCoverNameBlur}
                          placeholder="为封面命名"
                          className={`w-full px-2 py-1.5 text-xs rounded-md outline-none border ${
                            coverNameError
                              ? 'border-red-400 focus:ring-1 focus:ring-red-400'
                              : 'border-notion-border focus:ring-1 focus:ring-blue-400'
                          }`}
                        />
                        {coverNameError && (
                          <p className="text-[10px] text-red-500 mt-1">该名称已存在</p>
                        )}
                      </div>
                    )}
                    {/* Confirm / Cancel */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleConfirmUpload}
                        disabled={isUploading || (addToCoverLibrary && coverNameError)}
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

            {pickerTab === 'link' && (
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="粘贴图片链接..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && linkUrl.trim()) {
                      await updateMetadata(spaceSlug, pageId, { cover_url: linkUrl.trim() });
                    }
                  }}
                />
                <button
                  onClick={async () => {
                    if (linkUrl.trim()) {
                      await updateMetadata(spaceSlug, pageId, { cover_url: linkUrl.trim() });
                    }
                  }}
                  disabled={!linkUrl.trim()}
                  className="w-full px-3 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  提交
                </button>
              </div>
            )}

            {pickerTab === 'unsplash' && (
              <div className="p-3">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={unsplashQuery}
                    onChange={(e) => handleUnsplashQueryChange(e.target.value)}
                    placeholder="搜索图片..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {unsplashLoading && (
                  <div className="flex items-center justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
                  </div>
                )}
                {!unsplashLoading && unsplashResults.length > 0 && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {unsplashResults.map((photo) => (
                        <button
                          key={photo.id}
                          onClick={() => handleSelectUnsplash(photo.url)}
                          className="group/img relative h-16 rounded overflow-hidden hover:ring-2 hover:ring-blue-400 transition-all"
                        >
                          <img src={photo.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                          <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] text-white bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity truncate">
                            {photo.author}
                          </span>
                        </button>
                      ))}
                    </div>
                    {unsplashLoadingMore && (
                      <div className="flex items-center justify-center py-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
                      </div>
                    )}
                    {!unsplashLoadingMore && !unsplashHasMore && (
                      <p className="text-center text-xs text-gray-400 py-3">没有更多了</p>
                    )}
                  </>
                )}
                {!unsplashLoading && unsplashQuery && unsplashResults.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-4">未找到相关图片</p>
                )}
                {!unsplashQuery && (
                  <p className="text-center text-sm text-gray-400 py-4">输入关键词搜索 Unsplash 图片</p>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />
      {/* Upload progress - bottom right corner */}
      {isUploading && (
        <div className="absolute bottom-3 right-3 z-40">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-3 min-w-[160px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-notion-text font-medium">上传中...</span>
              <span className="text-xs text-notion-textSecondary">{uploadProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
