import { useState, useRef, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Check, Upload, Grid3X3, Search, Download } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';

// 图库分类数据（参考 Notion 封面图库分类）
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
    items: [
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1518173946687-a4c23ae3e658?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&h=400&fit=crop',
    ],
  },
  {
    id: 'architecture',
    label: '建筑',
    items: [
      'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1448630360428-65456885c650?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1511818966892-d7d671e672a2?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=1200&h=400&fit=crop',
    ],
  },
  {
    id: 'space',
    label: '太空',
    items: [
      'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1454789548928-9efd52dc4021?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1464802686167-b939a6910658?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1516849841032-87cbac4d88f9?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1200&h=400&fit=crop',
    ],
  },
  {
    id: 'art',
    label: '艺术',
    items: [
      'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1549887534-1541e9326642?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1578926288207-a90a5366759d?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-15419610177-4ff36fa9d699?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1577720643272-265f09367456?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=1200&h=400&fit=crop&q=80',
    ],
  },
  {
    id: 'abstract',
    label: '抽象',
    items: [
      'https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1567095761054-7a02e69e5571?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1578830993534-04f0c9a4e229?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=1200&h=400&fit=crop',
      'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=1200&h=400&fit=crop',
    ],
  },
];

// 缩略图映射（使用 Unsplash 的 thumb 参数）
const getThumbUrl = (url: string) => {
  if (url.startsWith('linear-gradient')) return null;
  return url.replace('w=1200&h=400', 'w=200&h=100');
};

interface CoverImageProps {
  coverUrl: string | null | undefined;
  coverOffset?: number;
  spaceSlug: string;
  pageId: number;
}

export default function CoverImage({ coverUrl, coverOffset: savedOffset, spaceSlug, pageId }: CoverImageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<'gallery' | 'upload' | 'link' | 'unsplash'>('gallery');
  const [galleryCategory, setGalleryCategory] = useState('gradient');
  const [linkUrl, setLinkUrl] = useState('');
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [coverOffset, setCoverOffset] = useState(savedOffset ?? 50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { updateMetadata } = usePageStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const coverRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const isDragging = useRef(false);

  // Unsplash search state
  const [unsplashQuery, setUnsplashQuery] = useState('');
  const [unsplashResults, setUnsplashResults] = useState<Array<{ id: string; url: string; thumb: string; author: string }>>([]);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_id', String(pageId));
      formData.append('space_slug', spaceSlug);

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
      const newCoverUrl = `/api/spaces/${spaceSlug}/pages/${pageId}/assets/${data.path}`;
      await updateMetadata(spaceSlug, pageId, { cover_url: newCoverUrl });
    } catch (error) {
      console.error('Failed to upload cover:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectPreset = async (preset: string) => {
    await updateMetadata(spaceSlug, pageId, { cover_url: preset });
    // Keep picker open so user can try different covers
  };

  const handleSelectUnsplash = async (url: string) => {
    await updateMetadata(spaceSlug, pageId, { cover_url: url });
    // Keep picker open so user can try different covers
  };

  const handleRemove = async () => {
    await updateMetadata(spaceSlug, pageId, { cover_url: '' });
    setShowPicker(false);
    setIsHovered(false);
  };

  // Unsplash search
  const searchUnsplash = useCallback(async (query: string) => {
    if (!query.trim()) {
      setUnsplashResults([]);
      return;
    }
    setUnsplashLoading(true);
    try {
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&orientation=landscape`,
        {
          headers: {
            Authorization: 'Client-ID ' + 'YOUR_UNSPLASH_ACCESS_KEY', // TODO: 替换为实际的 Unsplash Access Key
          },
        }
      );
      if (!response.ok) throw new Error('Unsplash search failed');
      const data = await response.json();
      setUnsplashResults(
        data.results.map((photo: any) => ({
          id: photo.id,
          url: photo.urls.raw + '&w=1200&h=400&fit=crop',
          thumb: photo.urls.thumb,
          author: photo.user.name,
        }))
      );
    } catch (error) {
      console.error('Unsplash search error:', error);
      setUnsplashResults([]);
    } finally {
      setUnsplashLoading(false);
    }
  }, []);

  const handleUnsplashQueryChange = (value: string) => {
    setUnsplashQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchUnsplash(value), 500);
  };

  const enterReposition = useCallback(() => {
    setIsRepositioning(true);
    isDragging.current = false;
    dragStartOffset.current = coverOffset;
  }, [coverOffset]);

  const exitReposition = useCallback(() => {
    setIsRepositioning(false);
    updateMetadata(spaceSlug, pageId, { cover_offset: coverOffset });
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
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartOffset.current = coverOffset;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const cover = coverRef.current;
      if (!cover) return;
      const coverHeight = cover.offsetHeight;
      const delta = e.clientY - dragStartY.current;
      const percentDelta = -(delta / coverHeight) * 100;
      const newOffset = Math.max(0, Math.min(100, dragStartOffset.current + percentDelta));
      setCoverOffset(newOffset);
    };

    const handleMouseUp = () => { isDragging.current = false; };

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

  if (!coverUrl) {
    return (
      <div className="relative group">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-0.5 text-sm text-notion-textSecondary hover:bg-notion-hover rounded transition-colors"
        >
          <ImageIcon className="w-4 h-4" />
          添加封面
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
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
          className="absolute top-12 right-3 w-[460px] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30"
        >
          {/* Tabs */}
          <div className="flex items-center border-b border-gray-100">
            <div className="flex">
              {([
                { key: 'gallery', label: '图库', Icon: Grid3X3 },
                { key: 'upload', label: '上传', Icon: Upload },
                { key: 'link', label: '链接', Icon: ImageIcon },
                { key: 'unsplash', label: 'Unsplash', Icon: Search },
              ] as const).map(({ key, label, Icon }) => (
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
          <div className="max-h-[300px] overflow-y-auto">
            {pickerTab === 'gallery' && (
              <>
                {/* Category tabs */}
                <div className="flex gap-1 px-3 pt-3 pb-2">
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
                  <div className={`grid gap-2 ${galleryCategory === 'gradient' ? 'grid-cols-4' : 'grid-cols-4'}`}>
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
                </div>
              </>
            )}

            {pickerTab === 'upload' && (
              <div className="p-4">
                <button
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-notion-text hover:bg-gray-50 transition-colors"
                  onClick={() => { fileInputRef.current?.click(); }}
                >
                  上传文件
                </button>
                <p className="mt-3 text-xs text-gray-400 text-center">
                  或使用⌘+V粘贴图片
                </p>
                <p className="mt-1 text-xs text-gray-400 text-center">
                  宽于 1500 像素的图片效果最佳。
                </p>
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

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
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
