import { useState } from 'react';
import { X } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';

interface PageIconProps {
  icon: string | null | undefined;
  spaceSlug: string;
  pageId: number;
}

const EMOJI_CATEGORIES = {
  '常用': ['📝', '📚', '💡', '🎯', '🚀', '⭐', '🔥', '💻', '📊', '🎨', '📌', '✅'],
  '表情': ['❤️', '😊', '🎉', '👍', '💪', '🎵', '🌟', '🎁', '🏆', '👋'],
  '自然': ['🌸', '🌿', '🌊', '☀️', '🌙', '🌈', '🍀', '🌺', '🔮', '💎'],
  '物品': ['📁', '📎', '🔧', '🔑', '💰', '📷', '🎨', '✏️', '📐', '🗂️'],
};

export default function PageIcon({ icon, spaceSlug, pageId }: PageIconProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { updateMetadata } = usePageStore();

  const handleSelectEmoji = async (emoji: string) => {
    await updateMetadata(spaceSlug, pageId, { icon: emoji });
    setIsOpen(false);
  };

  const handleRemove = async () => {
    await updateMetadata(spaceSlug, pageId, { icon: '' });
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block">
      {!icon ? (
        <button
          onClick={() => setIsOpen(true)}
          className="text-sm text-notion-textSecondary hover:text-notion-text hover:bg-notion-hover px-2 py-1 rounded transition-colors"
        >
          添加图标
        </button>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="text-5xl leading-none hover:opacity-80 transition-opacity py-2"
        >
          {icon}
        </button>
      )}

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-2 bg-white border border-notion-border rounded-xl shadow-xl z-50 w-72 overflow-hidden">
            <div className="p-3 border-b border-notion-border">
              <p className="text-xs font-medium text-notion-textSecondary uppercase tracking-wider">选择图标</p>
            </div>
            <div className="p-3 max-h-64 overflow-y-auto">
              {Object.entries(EMOJI_CATEGORIES).map(([category, emojis]) => (
                <div key={category} className="mb-3">
                  <p className="text-xs font-medium text-notion-textSecondary mb-1.5">{category}</p>
                  <div className="flex flex-wrap gap-0.5">
                    {emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleSelectEmoji(emoji)}
                        className="w-9 h-9 text-xl hover:bg-notion-hover rounded-lg flex items-center justify-center transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {icon && (
              <div className="border-t border-notion-border p-2">
                <button
                  onClick={handleRemove}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  移除图标
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
