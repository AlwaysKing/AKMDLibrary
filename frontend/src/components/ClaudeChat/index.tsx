import { useEffect, useState } from 'react';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { FloatingButton } from './FloatingButton';
import { ChatPanel } from './ChatPanel';

export function ClaudeChat() {
  const [open, setOpen] = useState(false);
  const { user, isAuthenticated } = useAuthStore();
  const currentSpace = useSpaceStore(s => s.currentSpace);

  // 切换 space 自动关闭面板
  useEffect(() => {
    setOpen(false);
  }, [currentSpace?.slug]);

  // 未登录不显示
  if (!isAuthenticated || !user) return null;

  // 当前 space 未启用 claude 不显示
  if (!currentSpace || !currentSpace.feature_flags?.claude) return null;

  return (
    <>
      {!open && <FloatingButton onClick={() => setOpen(true)} />}
      {open && <ChatPanel spaceSlug={currentSpace.slug} onClose={() => setOpen(false)} />}
    </>
  );
}
