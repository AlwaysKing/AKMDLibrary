interface DesktopTitleBarProps {
  sidebarWidth: number;
}

export default function DesktopTitleBar({ sidebarWidth }: DesktopTitleBarProps) {
  return (
    <header
      className="desktop-titlebar flex h-10 flex-shrink-0 items-center border-b border-notion-border bg-notion-sidebarBg px-[78px]"
      aria-label="AKMDLibrary 窗口标题栏"
    >
      <div
        className="pointer-events-none flex min-w-0 flex-1 items-center justify-center gap-2 select-none"
        style={sidebarWidth > 0 ? { transform: `translateX(-${sidebarWidth / 2}px)` } : undefined}
      >
        <img
          src="/icons/icon-192.png"
          alt=""
          className="h-4 w-4 rounded-[4px]"
          draggable={false}
        />
        <span className="truncate text-xs font-medium tracking-wide text-notion-sidebarText">
          AKMDLibrary
        </span>
      </div>
    </header>
  );
}
