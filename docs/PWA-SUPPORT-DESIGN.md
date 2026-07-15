# PWA 支持 — 设计方案

> **更新（2026-07-15）：** 方案已升级。原方案使用 `"sizes":"any"` + SVG 兜底图标，
> 触发 Chrome 已知 bug（[crbug 40925759](https://issuetracker.google.com/issues/40925759)），
> 浏览器不弹安装提示。现改为：
> - 默认图标随仓库分发（PNG 192/512/maskable 三档），由 `frontend/scripts/generate-pwa-icons.mjs` 烘焙
> - 上传 favicon 时后端用 `golang.org/x/image` 解码并烘焙三档 PNG
> - manifest 引用具体尺寸 PNG + `id` / `display_override` / `orientation` / `categories` 字段
> - SW 升级为 App Shell 预缓存 + stale-while-revalidate（API 旁路，不缓存用户数据）
> - 补 `apple-touch-icon` / `mask-icon` / `description` / `apple-mobile-web-app-*` 等 iOS 兼容 meta
>
> 原文保留如下作为决策溯源。详细任务拆解见
> `docs/superpowers/plans/2026-07-15-pwa-installability.md`。

## 目标

让 AKMDLibrary 在 HTTPS 部署后被浏览器判定为可安装 PWA（能"添加到主屏幕/安装成 App"）。
不做离线缓存（用户选择 A 方案）。

## 范围与非目标

- **范围内**：可安装性（manifest + 最小 SW）、图标和站点名跟随站点设置联动。
- **非目标**：离线访问、API 响应缓存、push 通知、后台同步。

## 选型与决策

- **方案：后端动态生成 manifest**（不使用 `vite-plugin-pwa`，零前端新依赖）
  - 理由：站点名 / 图标由管理员通过 `/api/site-settings` 动态配置；静态 manifest 无法反映这些变化，动态生成是唯一干净的方案。
- **图标策略**：manifest 中使用 `"sizes": "any"`，由浏览器按需缩放，避免后端切图。
- **SW 策略**：纯占位（仅 `fetch` no-op 监听器），只为满足 Chrome 可安装性判定。

## 改动清单

### 后端 (`backend/`)

1. `internal/handler/site_setting_handler.go` 增加两个 handler：
   - `ServeManifest(w, r)`：
     - 读当前 `SiteSettings`（`site_name`, `favicon`）
     - 返回 JSON manifest，`Content-Type: application/manifest+json`，`Cache-Control: no-cache`
     - `name`/`short_name` 用 `site_name`，为空时降级 `"MD Library"`
   - `ServePWAIcon(w, r)`：
     - 复用 `GetFaviconPath()`
     - 有自定义 favicon → 按实际扩展名设 `Content-Type`，`http.ServeFile`
     - 无自定义 → 重定向到 `/vite.svg`（或 404，由浏览器自动用 `rel="icon"` 的 favicon 兜底）
     - `Cache-Control: no-cache`（因为同一 URL 内容会变）

2. `cmd/server/main.go` 公开路由区新增：
   - `r.Get("/api/manifest.webmanifest", siteSettingHandler.ServeManifest)`
   - `r.Get("/api/site-assets/pwa-icon", siteSettingHandler.ServePWAIcon)`
   - **注意**：`pwa-icon` 必须注册在 `/api/site-assets/{filename}` 通配之前，chi 路由器会优先匹配精确路径。

### 前端 (`frontend/`)

1. `index.html` — `<head>` 增加两行：
   ```html
   <link rel="manifest" href="/api/manifest.webmanifest" />
   <meta name="theme-color" content="#ffffff" />
   ```

2. `public/sw.js`（新增）：
   ```js
   self.addEventListener('install', () => self.skipWaiting());
   self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
   self.addEventListener('fetch', () => {}); // no-op
   ```

3. `src/main.tsx`（注册 SW，仅生产）：
   ```ts
   if ('serviceWorker' in navigator && import.meta.env.PROD) {
     navigator.serviceWorker.register('/sw.js').catch(() => {});
   }
   ```

## Manifest 形状

```json
{
  "name": "<site_name 或 'MD Library'>",
  "short_name": "<同上>",
  "description": "MD Library",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/api/site-assets/pwa-icon", "sizes": "any", "purpose": "any" },
    { "src": "/api/site-assets/pwa-icon", "sizes": "any", "purpose": "maskable" }
  ]
}
```

省略 icon 的 `type` 字段——浏览器以响应 `Content-Type` 为准，更鲁棒。

## 已知 trade-off / 注意事项

1. **HTTPS 前看不到效果**：Chrome 要求 secure context 才允许安装，部署 HTTPS 前不可验证，符合预期。
2. **maskable 裁切**：管理员上传的图标若没有安全边距，Android 圆角图标可能被裁；非阻塞性 UX 问题。
3. **已安装 PWA 的图标更新滞后**：浏览器周期性重新拉取 manifest，不是实时的；改完图标不会立刻反映到已安装实例。
4. **SW 在开发环境不注册**：通过 `import.meta.env.PROD` 门控，避免 Vite HMR 与 SW 冲突。
5. **Manifest 缓存**：`Cache-Control: no-cache` 保证浏览器每次重新验证，站点设置变更能及时生效。

## 验证步骤

部署 HTTPS 后：
1. Chrome DevTools → Application → Manifest：应能看到 name/icons 正确加载，无报错
2. Application → Service Workers：应显示 `/sw.js` activated and running
3. 地址栏右侧应出现"安装"图标
4. 修改管理员上传的 favicon → 刷新 → 重新打开 Manifest 面板，icon 应已更新
5. 修改 `site_name` → 同上，name 字段应已更新
