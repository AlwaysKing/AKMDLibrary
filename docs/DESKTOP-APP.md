# macOS 桌面版

桌面版复用与 Docker 版相同的 Go 服务、业务代码和前端构建产物，只在进程入口增加 Wails 宿主。

## 运行方式

```text
Wails Window
├── macOS Full Size Content 窗口
│   ├── 原生红黄绿窗口按钮
│   └── 前端自绘可拖动标题栏
└── bootstrap 页面
    └── 跳转到 http://127.0.0.1:<随机端口>/?desktop=1
        ├── /api/*      → 本机 Go 服务
        ├── 静态资源     → 本机 Go 服务中的 frontend/dist
        ├── SPA 路由     → 本机 Go 服务
        └── WebSocket   → 同源直连本机 Go 服务
```

Go 服务只监听 `127.0.0.1` 的随机端口，不对外暴露。
桌面端通过 `?desktop=1` 标记禁用 PWA Service Worker，并把桌面状态保存在当前窗口的
`sessionStorage` 中。

桌面窗口使用 Wails 的 Full Size Content 模式，隐藏系统标题文字和标题栏样式，
由前端绘制标题栏背景、品牌和拖动区域；macOS 原生红黄绿窗口按钮继续保留。
标题栏拖动由 AppKit 原生覆盖视图处理，在 `mouseDown` 中直接调用
`performWindowDragWithEvent:`，不经过 JavaScript 异步消息。
浮层 iframe 路由不显示桌面标题栏。

## 数据目录

macOS 默认目录：

```text
~/Library/Application Support/AKMDLibrary/
├── data/
├── docs/
├── jwt_secret
└── desktop.log
```

可通过 `DATA_DIR`、`DOCS_DIR` 和 `JWT_SECRET` 覆盖。

## 构建

```bash
cd frontend
npm ci
cd ..
./scripts/build-desktop-macos.sh
```

构建产物默认写入：

```text
/tmp/AKMDLibrary/desktop/AKMDLibrary.app
```

可通过 `AKMDL_DESKTOP_OUT` 修改输出目录。

VS Code / CCGUI 可直接运行任务：

```text
Build, Sign and Install Desktop App
Run Desktop Debug
```

该任务会构建、签名并覆盖安装到 `/Applications/AKMDLibrary.app`。

`Run Desktop Debug` 会同时启动：

- Vite 开发服务器：`http://127.0.0.1:8802`
- Wails 桌面窗口：加载 Vite 页面
- Go 后端：`http://127.0.0.1:8801`

Vite 的 `/api` 代理会转发到 Go 后端，Vite 的 HMR WebSocket 不经过 Wails AssetServer，
因此开发时热更新可正常工作。

## 创建空间导入

桌面版创建空间时，可在确认/取消按钮前点击文件夹图标选择本地目录：

- **迁入**：把所选目录的内容复制到 `docs/<空间名>/`
- **引用**：创建 `docs/<空间名> -> 所选目录` 的软链接

引用模式依赖既有的空间根目录软链接扫描逻辑，不会修改源目录。迁入模式不删除源目录，
目标目录冲突时直接报错。

## 打包说明

- `frontend/dist` 会复制到 app 的 `Contents/Resources/html`
- Go 桌面入口会从该资源目录读取前端文件
- 未提供开发者证书时，构建脚本使用 ad-hoc 签名
- 正式签名可通过 `AKMDL_CODESIGN_IDENTITY` 指定 Developer ID
- 正式发布仍需使用 Developer ID 签名并完成 Apple 公证
