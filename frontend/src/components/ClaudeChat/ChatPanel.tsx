import { useEffect, useRef, useState, DragEvent } from 'react';
import { X } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput, PendingAttachment, nextLocalId, MAX_SIZE } from './MessageInput';
import { useClaudeChat, ChatAttachment } from '../../hooks/useClaudeChat';

interface Props {
  spaceSlug: string;
  /** 是否显示。关闭时通过 CSS hidden 隐藏而非卸载，保留 WS 与面板状态 */
  open: boolean;
  onClose: () => void;
}

const MIN_W = 320;
const MIN_H = 360;
// 面板与窗口边的最小留白：拖动/缩放/窗口缩放都遵循
const EDGE_MARGIN = 8;

/** 从当前 URL 提取 page id（路由 /:space/p/:id） */
function getCurrentPageId(): string | undefined {
  const m = window.location.pathname.match(/\/p\/([^/]+)$/);
  return m?.[1];
}

/** resize 起点：记录起始鼠标坐标、起始尺寸、起始左上角坐标、哪个角 */
interface ResizeStart {
  mx: number;
  my: number;
  w: number;
  h: number;
  px: number;
  py: number;
  corner: 'tl' | 'br';
}

export function ChatPanel({ spaceSlug, open, onClose }: Props) {
  const { messages, status, send, uploadAttachment } = useClaudeChat({ spaceSlug, enabled: true });
  // 初始位置：让面板距右边缘和底边缘各 20px（与 size 460x520 配合）
  const [pos, setPos] = useState({ x: window.innerWidth - 480, y: window.innerHeight - 540 });
  const [size, setSize] = useState({ w: 460, h: 520 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<ResizeStart | null>(null);

  // 用 ref 镜像 pos/size，让全局事件回调（mousemove / window resize）能读到最新值，
  // 而不必把 pos/size 放进 useEffect deps（那样每次拖动都要重新 bind/unbind）。
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current = pos;
  sizeRef.current = size;

  // 附件 pendings 状态提升到面板级：整个面板都是 drop target
  const [pendings, setPendings] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const uploadOne = async (file: File) => {
    if (file.size > MAX_SIZE) {
      const localId = nextLocalId();
      setPendings(prev => [...prev, {
        localId,
        filename: file.name,
        status: 'error',
        error: `${file.name} 超过 5MB 上限`,
      }]);
      return;
    }
    const localId = nextLocalId();
    // 占位 uploading 状态
    setPendings(prev => [...prev, { localId, filename: file.name, status: 'uploading' }]);
    try {
      const { attachmentId, filename } = await uploadAttachment(file);
      // 后端可能给去重后的 filename，更新本地
      setPendings(prev => prev.map(p =>
        p.localId === localId
          ? { ...p, status: 'done', attachmentId, filename }
          : p
      ));
    } catch (e: any) {
      setPendings(prev => prev.map(p =>
        p.localId === localId
          ? { ...p, status: 'error', error: e?.message || '上传失败' }
          : p
      ));
    }
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(uploadOne);
  };

  const removePending = (localId: string) => {
    setPendings(prev => prev.filter(p => p.localId !== localId));
  };

  // 整个面板的 drop 处理：拖到面板任何区域都能上传
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 防止冒泡到文档页编辑器
    setDragOver(false);
    if (status === 'answering') return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: DragEvent) => {
    // 必须 preventDefault 才能让 drop 生效；否则浏览器走默认（打开文件）
    e.preventDefault();
    e.stopPropagation();
    if (status !== 'answering') setDragOver(true);
  };

  const onDragLeave = (e: DragEvent) => {
    // 仅当离开整个容器才取消高亮（避免子元素触发 dragleave）
    if (e.currentTarget === e.target) setDragOver(false);
  };

  // 拖拽 + 调整大小（用 ref 读取最新值，避免 size 进 deps 导致反复 bind）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { w, h } = sizeRef.current;
        const maxX = window.innerWidth - w - EDGE_MARGIN;
        const maxY = window.innerHeight - h - EDGE_MARGIN;
        setPos({
          x: Math.max(EDGE_MARGIN, Math.min(maxX, e.clientX - dragRef.current.dx)),
          y: Math.max(EDGE_MARGIN, Math.min(maxY, e.clientY - dragRef.current.dy)),
        });
        return;
      }
      const r = resizeRef.current;
      if (r) {
        const dx = e.clientX - r.mx;
        const dy = e.clientY - r.my;
        if (r.corner === 'br') {
          // 右下角：尺寸随鼠标变化，左上角不动；右侧/底部至少留 EDGE_MARGIN
          const newW = Math.max(MIN_W, Math.min(window.innerWidth - r.px - EDGE_MARGIN, r.w + dx));
          const newH = Math.max(MIN_H, Math.min(window.innerHeight - r.py - EDGE_MARGIN, r.h + dy));
          setSize({ w: newW, h: newH });
        } else {
          // 左上角：右下角不动，反算尺寸与新的左上角；左/上至少留 EDGE_MARGIN
          const fixedRight = r.px + r.w;
          const fixedBottom = r.py + r.h;
          const newW = Math.max(MIN_W, r.w - dx);
          const newH = Math.max(MIN_H, r.h - dy);
          const newX = Math.max(EDGE_MARGIN, Math.min(fixedRight - MIN_W, fixedRight - newW));
          const newY = Math.max(EDGE_MARGIN, Math.min(fixedBottom - MIN_H, fixedBottom - newH));
          setSize({ w: fixedRight - newX, h: fixedBottom - newY });
          setPos({ x: newX, y: newY });
        }
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 浏览器窗口缩放：面板跟随最近的边移动
  // 例如默认锚定右下角，窗口扩大时面板跟着右下移；缩小时反向避让
  // 关键：判断"原来更靠近哪边"必须用变化前的窗口尺寸，否则窗口扩大时
  // panel 与右边的"新距离"会变大、误判成贴左，导致面板不跟随
  const prevWinRef = useRef({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => {
      const curPos = posRef.current;
      const curSize = sizeRef.current;
      const prevW = prevWinRef.current.w;
      const prevH = prevWinRef.current.h;

      // 窗口可能变得比面板还小：先把 size 夹到可见范围（至少留 EDGE_MARGIN）
      const maxW = Math.max(MIN_W, window.innerWidth - EDGE_MARGIN * 2);
      const maxH = Math.max(MIN_H, window.innerHeight - EDGE_MARGIN * 2);
      const newW = Math.min(curSize.w, maxW);
      const newH = Math.min(curSize.h, maxH);

      // 用"变化前"的窗口尺寸算面板到各边的原距离，判断原来贴哪边
      const distLeft = curPos.x;
      const distRight = prevW - (curPos.x + curSize.w);
      const distTop = curPos.y;
      const distBottom = prevH - (curPos.y + curSize.h);

      let newX: number;
      if (distRight <= distLeft) {
        // 原来贴右：保持右边缘距离（不小于 EDGE_MARGIN）
        const keepRight = Math.max(EDGE_MARGIN, distRight);
        newX = window.innerWidth - newW - keepRight;
      } else {
        // 原来贴左：保持左边缘距离
        newX = Math.max(EDGE_MARGIN, distLeft);
      }
      newX = Math.min(newX, window.innerWidth - newW - EDGE_MARGIN);

      let newY: number;
      if (distBottom <= distTop) {
        const keepBottom = Math.max(EDGE_MARGIN, distBottom);
        newY = window.innerHeight - newH - keepBottom;
      } else {
        newY = Math.max(EDGE_MARGIN, distTop);
      }
      newY = Math.min(newY, window.innerHeight - newH - EDGE_MARGIN);

      setSize({ w: newW, h: newH });
      setPos({ x: newX, y: newY });
      prevWinRef.current = { w: window.innerWidth, h: window.innerHeight };
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };

  const startResize = (e: React.MouseEvent, corner: 'tl' | 'br') => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y, corner };
    document.body.style.cursor = corner === 'br' ? 'nwse-resize' : 'nwse-resize'; // 两个角视觉上都用斜向光标
    document.body.style.userSelect = 'none';
  };

  // 包装 send：发送时附带当前 page id（URL 提取，让 claude 知道用户在哪个文档）
  const handleSend = (text: string, attachments?: ChatAttachment[]) => {
    send(text, { activePageId: getCurrentPageId() }, attachments);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      data-claude-chat="true"
      className={`fixed z-50 bg-notion-bg border border-notion-border rounded-lg shadow-2xl flex flex-col overflow-hidden${open ? '' : ' hidden'}`}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {dragOver && (
        <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-blue-400 rounded flex items-center justify-center bg-blue-50/80 z-20">
          <span className="text-sm text-blue-700">松开以上传文件</span>
        </div>
      )}
      <div
        onMouseDown={startDrag}
        className="px-3 py-2 bg-notion-text text-white flex items-center justify-between cursor-move select-none"
      >
        <span className="text-sm font-medium">Agent</span>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded" title="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>
      <MessageList messages={messages} status={status} />
      <MessageInput
        onSend={handleSend}
        disabled={status === 'answering'}
        uploadAttachment={uploadAttachment}
        pendings={pendings}
        onRemovePending={removePending}
        onFiles={handleFiles}
      />

      {/* 左上角调整大小：hover 才显示 */}
      <div
        onMouseDown={(e) => startResize(e, 'tl')}
        className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize opacity-0 hover:opacity-100 hover:bg-blue-500/60 z-30 transition-opacity outline-none select-none focus:outline-none"
        title="拖动调整大小"
      >
        <svg viewBox="0 0 10 10" className="w-full h-full text-white pointer-events-none">
          <path d="M1 9 L9 1 M5 9 L9 5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
      {/* 右下角调整大小：hover 才显示 */}
      <div
        onMouseDown={(e) => startResize(e, 'br')}
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize opacity-0 hover:opacity-100 hover:bg-blue-500/60 z-30 transition-opacity outline-none select-none focus:outline-none"
        title="拖动调整大小"
      >
        <svg viewBox="0 0 10 10" className="w-full h-full text-white pointer-events-none">
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
