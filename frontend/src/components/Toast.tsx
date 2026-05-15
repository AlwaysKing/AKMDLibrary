import { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

interface ToastItem {
  id: number;
  message: string;
}

let toastQueue: ToastItem[] = [];
let nextId = 0;
let setToastsExternal: ((toasts: ToastItem[]) => void) | null = null;

function showToast(message: string, duration = 2000) {
  const id = nextId++;
  toastQueue = [...toastQueue, { id, message }];
  setToastsExternal?.(toastQueue);
  setTimeout(() => {
    toastQueue = toastQueue.filter(t => t.id !== id);
    setToastsExternal?.(toastQueue);
  }, duration);
}

export { showToast };

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  setToastsExternal = setToasts;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <ToastMessage key={t.id} message={t.message} />
      ))}
    </div>
  );
}

function ToastMessage({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={`
        px-4 py-2 rounded-lg bg-[#2f2f2f] text-white text-sm shadow-lg
        transition-all duration-300 ease-in-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      {message}
    </div>
  );
}

// Mount the container once
let mounted = false;
function mountToastContainer() {
  if (mounted) return;
  mounted = true;
  const div = document.createElement('div');
  div.id = 'toast-root';
  document.body.appendChild(div);
  const root = createRoot(div);
  root.render(<ToastContainer />);
}

// Auto-mount on import
if (typeof document !== 'undefined') {
  mountToastContainer();
}
