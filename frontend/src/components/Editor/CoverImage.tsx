import { useState, useRef } from 'react';
import { X, Image as ImageIcon, Camera } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';

interface CoverImageProps {
  coverUrl: string | null | undefined;
  spaceSlug: string;
  pageId: number;
}

export default function CoverImage({ coverUrl, spaceSlug, pageId }: CoverImageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { updateMetadata } = usePageStore();
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_id', String(pageId));
      formData.append('space_slug', spaceSlug);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      const coverUrl = `/api/spaces/${spaceSlug}/pages/${pageId}/assets/${data.path}`;
      await updateMetadata(spaceSlug, pageId, { cover_url: coverUrl });
    } catch (error) {
      console.error('Failed to upload cover:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    await updateMetadata(spaceSlug, pageId, { cover_url: '' });
  };

  if (!coverUrl) {
    return (
      <div className="relative group">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-notion-textSecondary hover:bg-notion-hover rounded transition-colors"
        >
          <ImageIcon className="w-4 h-4" />
          添加封面
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

  return (
    <div
      className="relative h-[350px] bg-cover bg-center group"
      style={{ backgroundImage: `url(${coverUrl})` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded hover:bg-gray-100 transition-colors text-notion-text text-sm"
          >
            <Camera className="w-4 h-4" />
            更换封面
          </button>
          <button
            onClick={handleRemove}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded hover:bg-gray-100 transition-colors text-notion-text text-sm"
          >
            <X className="w-4 h-4" />
            移除
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      {isUploading && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      )}
    </div>
  );
}
