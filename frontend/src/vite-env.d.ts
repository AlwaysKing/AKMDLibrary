/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 注入的编译时间（ISO 字符串）
declare const __BUILD_TIME__: string;

interface Window {
  __AKMD_DESKTOP__?: boolean;
  __AKMD_WS_BASE__?: string;
  runtime?: {
    BrowserOpenURL?: (url: string) => void;
  };
}
