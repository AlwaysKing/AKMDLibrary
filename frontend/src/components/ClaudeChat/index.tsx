import { useEffect, useState } from 'react';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { FloatingButton } from './FloatingButton';
import { ChatPanel } from './ChatPanel';

export function ClaudeChat() {
  const [open, setOpen] = useState(false);
  const { user, isAuthenticated } = useAuthStore();
  const currentSpace = useSpaceStore(s => s.currentSpace);

  // 切换 space 自动隐藏面板（WS 会在 useClaudeChat 的 space 变化副作用里断开）
  useEffect(() => {
    setOpen(false);
  }, [currentSpace?.slug]);

  // 未登录不显示
  if (!isAuthenticated || !user) return null;

  // 当前 space 未启用 claude 不显示
  if (!currentSpace || !currentSpace.feature_flags?.claude) return null;

  // 关键：ChatPanel 始终挂载，关闭只是 CSS 隐藏
  // 这样 WS / 消息状态 / 面板位置尺寸 都保留，不随关闭而丢失
  return (
    <>
      {!open && <FloatingButton onClick={() => setOpen(true)} />}
      <ChatPanel
        spaceSlug={currentSpace.slug}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
