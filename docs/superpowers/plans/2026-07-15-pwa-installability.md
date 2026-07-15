# PWA 可安装性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Chrome 等浏览器判定 AKMDLibrary 为可安装 PWA（出现"安装"按钮），并把现有最小实现升级为带 App Shell 缓存、自定义 favicon 自动切图、iOS 兼容的完整方案。

**Architecture:**
- 默认图标用 dev-time 脚本从 `vite.svg` 烘焙出 PNG（192/512/maskable）随仓库分发。
- manifest 端点改成引用具体尺寸的 PNG，并补齐 `id` / `display_override` / `orientation` 等字段。
- 上传 favicon 时后端用 `golang.org/x/image/draw` 解码 + 缩放 + 合成 maskable，输出三档 PNG 到 siteDir。
- Service Worker 升级为 App Shell + stale-while-revalidate，离线可打开外壳；API 请求不走缓存，避免脏数据。
- `index.html` 补 apple-touch-icon / mask-icon / description 等 meta，iOS 兼容。

**Tech Stack:**
- Backend: Go 1.25, `golang.org/x/image/draw`、`image/png`、`image/jpeg`、`image/gif`、`golang.org/x/image/webp`、`golang.org/x/image/bmp`（ICO 内部用 BMP）
- Frontend: Vite + React（已有），新增 dev dep `sharp` 仅用于一次性烘焙图标
- Test: Go 标准 `testing`

---

## File Structure

**新建：**
- `frontend/scripts/generate-pwa-icons.mjs` — 一次性 dev 脚本，用 `sharp` 从 `vite.svg` 烘焙 PNG
- `frontend/public/icons/icon-192.png` — 默认 192×192 PNG（any purpose）
- `frontend/public/icons/icon-512.png` — 默认 512×512 PNG（any purpose）
- `frontend/public/icons/icon-512-maskable.png` — 默认 512×512 maskable PNG（带 ~10% 安全区 padding）
- `backend/internal/imageutil/imageutil.go` — 图像处理工具：`Decode`、`ResizePNG`、`ComposeMaskable`、`ProcessToPWAVariants`
- `backend/internal/imageutil/imageutil_test.go` — 单元测试
- `backend/internal/imageutil/testdata/src.png` — 测试用源图（脚本生成或借用现有图标）

**修改：**
- `backend/go.mod` / `go.sum` — 新增 `golang.org/x/image`
- `backend/internal/handler/site_setting_handler.go`
  - `ServeManifest`：用具体尺寸 PNG 路径 + 补 `id` / `display_override` / `orientation` / `short_name` 截断
  - `UploadFavicon`：保存原图后调用 `imageutil.ProcessToPWAVariants`
  - `ResetFavicon`：同时清理 `pwa-icon-*.png`
  - 新增 `ServePWAIcon192` / `ServePWAIcon512` / `ServePWAIcon512Maskable`（或单个带 size 参数的 handler），动态图标存在时返回 siteDir 内 PNG，否则代理到 `frontend/public/icons/` 静态文件
- `backend/cmd/server/main.go` — 注册新路由 `/api/site-assets/pwa-icon-{192,512,512-maskable}.png`，删除旧 `/api/site-assets/pwa-icon`
- `frontend/index.html` — 加 `apple-touch-icon`、`mask-icon`、`description` meta
- `frontend/public/sw.js` — App Shell 缓存 + SWR + API 旁路
- `frontend/src/main.tsx` — SW 注册后监听 `updatefound` → `skipWaiting` + 提示刷新
- `frontend/package.json` — devDependencies 加 `sharp`
- `docs/PWA-SUPPORT-DESIGN.md` — 更新方案（移除"不做离线缓存"、"sizes:any"等过时决策）

---

## Task 1: 烘焙默认 PNG 图标（前端）

**Files:**
- Create: `frontend/scripts/generate-pwa-icons.mjs`
- Create: `frontend/public/icons/icon-192.png`
- Create: `frontend/public/icons/icon-512.png`
- Create: `frontend/public/icons/icon-512-maskable.png`
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 sharp 作为 devDependency**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/frontend && npm install --save-dev sharp
```
Expected: `sharp` 出现在 `frontend/package.json` 的 `devDependencies`。

- [ ] **Step 2: 编写烘焙脚本**

Create `frontend/scripts/generate-pwa-icons.mjs`:
```javascript
// One-shot script: rasterize frontend/public/vite.svg into the PNG icons
// required by the PWA manifest. Run manually after changing the logo.
//
// Usage: node scripts/generate-pwa-icons.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'vite.svg');
const iconsDir = join(publicDir, 'icons');
mkdirSync(iconsDir, { recursive: true });

const svgBuf = readFileSync(svgPath);

// Maskable: render at 512 then composite onto an 80% canvas over theme color,
// leaving ~10% safe-zone padding on all sides.
async function bakeMaskable() {
  const inner = await sharp(svgBuf, { density: 384 })
    .resize(410, 410, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toFile(join(iconsDir, 'icon-512-maskable.png'));
}

await sharp(svgBuf, { density: 384 }).resize(192, 192).png().toFile(join(iconsDir, 'icon-192.png'));
await sharp(svgBuf, { density: 384 }).resize(512, 512).png().toFile(join(iconsDir, 'icon-512.png'));
await bakeMaskable();
console.log('PWA icons generated under frontend/public/icons/');
```

- [ ] **Step 3: 运行脚本生成 PNG**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/frontend && node scripts/generate-pwa-icons.mjs
```
Expected: stdout 打印 `PWA icons generated under frontend/public/icons/`，且 `frontend/public/icons/` 下出现三个 PNG 文件。

- [ ] **Step 4: 校验输出文件**

Run:
```bash
file frontend/public/icons/icon-192.png frontend/public/icons/icon-512.png frontend/public/icons/icon-512-maskable.png
```
Expected: 三个文件均显示 `PNG image data, 192 x 192` / `512 x 512` / `512 x 512`。

---

## Task 2: 后端添加 `golang.org/x/image` 依赖

**Files:**
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

- [ ] **Step 1: 添加依赖**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go get golang.org/x/image@latest
```
Expected: `go.mod` 的 require 块出现 `golang.org/x/image`。

- [ ] **Step 2: 同步 tidy**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go mod tidy
```
Expected: 无报错。

---

## Task 3: 创建 `imageutil` 包（含单测，TDD）

**Files:**
- Create: `backend/internal/imageutil/imageutil.go`
- Create: `backend/internal/imageutil/imageutil_test.go`
- Create: `backend/internal/imageutil/testdata/src.png`（用 Task 1 烘焙的 512 PNG 复制即可）

- [ ] **Step 1: 准备 testdata**

Run:
```bash
mkdir -p /Users/alwaysking/AKProject/AKMDLibrary/backend/internal/imageutil/testdata && cp /Users/alwaysking/AKProject/AKMDLibrary/frontend/public/icons/icon-512.png /Users/alwaysking/AKProject/AKMDLibrary/backend/internal/imageutil/testdata/src.png
```
Expected: testdata 目录存在，内含 `src.png`。

- [ ] **Step 2: 先写失败的测试**

Create `backend/internal/imageutil/imageutil_test.go`:
```go
package imageutil

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestDecode_PNG(t *testing.T) {
	b, err := os.ReadFile("testdata/src.png")
	if err != nil {
		t.Fatalf("read src: %v", err)
	}
	img, format, err := Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if format != "png" {
		t.Fatalf("format = %q, want png", format)
	}
	if img.Bounds().Dx() != 512 || img.Bounds().Dy() != 512 {
		t.Fatalf("bounds = %v, want 512x512", img.Bounds())
	}
}

func TestResizePNG(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	img, _, _ := Decode(bytes.NewReader(src))

	var buf bytes.Buffer
	if err := ResizePNG(&buf, img, 192); err != nil {
		t.Fatalf("resize: %v", err)
	}
	out, err := png.Decode(&buf)
	if err != nil {
		t.Fatalf("decode resized: %v", err)
	}
	if out.Bounds().Dx() != 192 || out.Bounds().Dy() != 192 {
		t.Fatalf("size = %v, want 192x192", out.Bounds())
	}
}

func TestComposeMaskable_HasPadding(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	img, _, _ := Decode(bytes.NewReader(src))

	var buf bytes.Buffer
	if err := ComposeMaskable(&buf, img, 512); err != nil {
		t.Fatalf("compose: %v", err)
	}
	out, _ := png.Decode(&buf)
	bounds := out.Bounds()
	if bounds.Dx() != 512 || bounds.Dy() != 512 {
		t.Fatalf("size = %v, want 512x512", bounds)
	}
	// Top-left corner should be background (white), since source is centered at 80%
	corner := out.At(0, 0)
	r, g, b, _ := corner.RGBA()
	if r < 0xF000 || g < 0xF000 || b < 0xF000 {
		t.Fatalf("corner pixel = (%d,%d,%d), expected near-white padding", r>>8, g>>8, b>>8)
	}
}

func TestProcessToPWAVariants(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	tmp := t.TempDir()
	variants, err := ProcessToPWAVariants(tmp, bytes.NewReader(src))
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	want := []string{"pwa-icon-192.png", "pwa-icon-512.png", "pwa-icon-512-maskable.png"}
	if len(variants) != len(want) {
		t.Fatalf("variants = %v, want %v", variants, want)
	}
	for _, name := range want {
		info, err := os.Stat(filepath.Join(tmp, name))
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if info.Size() == 0 {
			t.Fatalf("%s is empty", name)
		}
	}
}

// guard: ensure image package is referenced for completeness
var _ = image.Rect
```

- [ ] **Step 3: 跑测试，确认全部失败（FAIL: undefined）**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go test ./internal/imageutil/...
```
Expected: 编译失败，`undefined: Decode` / `ResizePNG` / `ComposeMaskable` / `ProcessToPWAVariants`。

- [ ] **Step 4: 实现 `imageutil.go`**

Create `backend/internal/imageutil/imageutil.go`:
```go
// Package imageutil decodes arbitrary uploaded images and produces the PNG
// variants required by the PWA manifest (192, 512, 512-maskable).
package imageutil

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
	"golang.org/x/image/draw"
)

// Decode reads an image stream and returns the decoded raster plus its format
// name (png / jpeg / gif / webp / bmp). Returns an error for SVG or unknown
// formats — callers should fall back to saving those as-is.
func Decode(r io.Reader) (image.Image, string, error) {
	img, format, err := image.Decode(r)
	if err != nil {
		return nil, "", fmt.Errorf("imageutil: decode: %w", err)
	}
	return img, format, nil
}

// ResizePNG scales img to size×size preserving aspect ratio (letterboxed
// with transparent background) and writes it to w as PNG.
func ResizePNG(w io.Writer, img image.Image, size int) error {
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	// Center-fit; transparent background (NewRGBA is zero-filled = transparent).
	srcBounds := img.Bounds()
	srcW, srcH := srcBounds.Dx(), srcBounds.Dy()
	scale := minf(float64(size)/float64(srcW), float64(size)/float64(srcH))
	outW := int(float64(srcW) * scale)
	outH := int(float64(srcH) * scale)
	r := image.Rect((size-outW)/2, (size-outH)/2, (size+outW)/2, (size+outH)/2)
	draw.CatmullRom.Scale(dst, r, img, srcBounds, draw.Over, nil)
	if err := png.Encode(w, dst); err != nil {
		return fmt.Errorf("imageutil: encode resized: %w", err)
	}
	return nil
}

// ComposeMaskable renders img onto a size×size opaque white canvas with the
// source centered at 80% scale — the ~10% safe zone required by Android's
// maskable icon spec.
func ComposeMaskable(w io.Writer, img image.Image, size int) error {
	canvas := image.NewRGBA(image.Rect(0, 0, size, size))
	// Fill with white.
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: image.NewUniform(white).C}, image.Point{}, draw.Src)

	// Prepare scaled source at 80%.
	innerSize := int(float64(size) * 0.8)
	inner := image.NewRGBA(image.Rect(0, 0, innerSize, innerSize))
	srcBounds := img.Bounds()
	srcW, srcH := srcBounds.Dx(), srcBounds.Dy()
	scale := minf(float64(innerSize)/float64(srcW), float64(innerSize)/float64(srcH))
	outW := int(float64(srcW) * scale)
	outH := int(float64(srcH) * scale)
	r := image.Rect((innerSize-outW)/2, (innerSize-outH)/2, (innerSize+outW)/2, (innerSize+outH)/2)
	draw.CatmullRom.Scale(inner, r, img, srcBounds, draw.Over, nil)

	// Center composite.
	offset := (size - innerSize) / 2
	draw.Draw(canvas, image.Rect(offset, offset, offset+innerSize, offset+innerSize), inner, image.Point{}, draw.Over)

	if err := png.Encode(w, canvas); err != nil {
		return fmt.Errorf("imageutil: encode maskable: %w", err)
	}
	return nil
}

// ProcessToPWAVariants decodes r and writes three PNGs into outDir:
//   - pwa-icon-192.png        (purpose: any)
//   - pwa-icon-512.png        (purpose: any)
//   - pwa-icon-512-maskable.png (purpose: maskable)
//
// Returns the relative filenames written.
func ProcessToPWAVariants(outDir string, r io.Reader) ([]string, error) {
	// Buffer so we can decode once but reuse for both pipelines.
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		return nil, fmt.Errorf("imageutil: read source: %w", err)
	}
	img, _, err := Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("imageutil: mkdir: %w", err)
	}
	names := []string{"pwa-icon-192.png", "pwa-icon-512.png", "pwa-icon-512-maskable.png"}
	for _, name := range names {
		f, err := os.Create(filepath.Join(outDir, name))
		if err != nil {
			return nil, fmt.Errorf("imageutil: create %s: %w", name, err)
		}
		switch name {
		case "pwa-icon-192.png":
			err = ResizePNG(f, img, 192)
		case "pwa-icon-512.png":
			err = ResizePNG(f, img, 512)
		case "pwa-icon-512-maskable.png":
			err = ComposeMaskable(f, img, 512)
		}
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("imageutil: write %s: %w", name, err)
		}
	}
	return names, nil
}

var white = image.NewUniform(image.NewRGBA(image.Rect(0, 0, 1, 1)).At(0, 0))

func minf(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
```

> 备注：上面 `white` 的定义有点绕，简化为：
```go
var white = image.NewUniform(color.RGBA{R: 255, G: 255, B: 255, A: 255})
```
并在 import 加 `"image/color"`。`ComposeMaskable` 中 `&image.Uniform{C: ...}` 那行改成 `white`。

- [ ] **Step 5: 跑测试，确认全过**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go test ./internal/imageutil/... -v
```
Expected: PASS（4 个 test case 全绿）。

---

## Task 4: 重构 `ServeManifest` 用具体尺寸 PNG

**Files:**
- Modify: `backend/internal/handler/site_setting_handler.go:229-266`

- [ ] **Step 1: 替换 `ServeManifest`**

替换 `ServeManifest` 整段为：
```go
// ServeManifest returns a PWA Web App Manifest reflecting current site settings (public).
// Uses concrete PNG sizes (192/512/maskable) — Chrome rejects SVG with sizes:"any".
// Icon URLs switch between the bundled defaults and admin-uploaded PNGs depending
// on whether a custom favicon is configured.
func (h *SiteSettingHandler) ServeManifest(w http.ResponseWriter, r *http.Request) {
	settings, err := h.siteSettingService.Get()
	if err != nil {
		http.Error(w, "Failed to load site settings", http.StatusInternalServerError)
		return
	}

	name := "MD Library"
	if settings != nil && settings.SiteName != nil && *settings.SiteName != "" {
		name = *settings.SiteName
	}
	shortName := shortNameFrom(name)

	hasCustom := h.HasCustomFavicon()
	icon192, icon512, iconMask := h.pwaIconURLs(hasCustom)

	manifest := map[string]any{
		"id":               "/",
		"name":             name,
		"short_name":       shortName,
		"description":      "MD Library — self-hosted markdown library",
		"start_url":        "/",
		"scope":            "/",
		"display":          "standalone",
		"display_override": []string{"standalone", "minimal-ui"},
		"orientation":      "any",
		"background_color": "#ffffff",
		"theme_color":      "#ffffff",
		"categories":       []string{"productivity", "education"},
		"icons": []map[string]any{
			{"src": icon192, "sizes": "192x192", "type": "image/png", "purpose": "any"},
			{"src": icon512, "sizes": "512x512", "type": "image/png", "purpose": "any"},
			{"src": iconMask, "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
		},
	}

	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(manifest); err != nil {
		http.Error(w, "Failed to encode manifest", http.StatusInternalServerError)
		return
	}
}

// shortNameFrom truncates name to ≤12 runes (Chrome recommendation) for the
// home-screen icon label.
func shortNameFrom(name string) string {
	runes := []rune(name)
	if len(runes) <= 12 {
		return name
	}
	return string(runes[:12])
}
```

- [ ] **Step 2: 替换 `ServePWAIcon` 为带 size 参数的版本 + 帮助函数**

替换 `ServePWAIcon` 整段（含注释）为：
```go
// pwaIconURLs returns the three icon URLs the manifest should reference.
// When a custom favicon is configured, they point at the generated PNGs under
// /api/site-assets/; otherwise they fall back to the bundled defaults in
// frontend/public/icons/.
func (h *SiteSettingHandler) pwaIconURLs(hasCustom bool) (string, string, string) {
	if hasCustom {
		return "/api/site-assets/pwa-icon-192.png",
			"/api/site-assets/pwa-icon-512.png",
			"/api/site-assets/pwa-icon-512-maskable.png"
	}
	return "/icons/icon-192.png",
		"/icons/icon-512.png",
		"/icons/icon-512-maskable.png"
}

// HasCustomFavicon reports whether the admin has uploaded a custom favicon
// (and therefore the generated PWA PNG variants exist in siteDir).
func (h *SiteSettingHandler) HasCustomFavicon() bool {
	matches, _ := filepath.Glob(filepath.Join(h.siteDir, "pwa-icon-512.png"))
	return len(matches) > 0
}

// ServePWAIconSized serves one of the three generated PWA PNG variants.
// When no custom favicon is configured, it 302-redirects to the bundled
// default under /icons/. (Manifest always points at this endpoint when custom
// favicon is configured, so the redirect path is only used when the operator
// deleted files mid-flight.)
func (h *SiteSettingHandler) ServePWAIconSized(w http.ResponseWriter, r *http.Request) {
	size := chi.URLParam(r, "size") // "192" | "512" | "512-maskable"
	fname := "pwa-icon-" + size + ".png"
	full := filepath.Join(h.siteDir, fname)
	if _, err := os.Stat(full); err != nil {
		// Fall back to bundled default (maskable uses same file as plain 512).
		static := map[string]string{
			"192":          "/icons/icon-192.png",
			"512":          "/icons/icon-512.png",
			"512-maskable": "/icons/icon-512-maskable.png",
		}[size]
		if static == "" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, static, http.StatusFound)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, full)
}
```

需要在文件顶部 import 块加入：`"github.com/go-chi/chi/v5"`。

- [ ] **Step 3: 删除旧 `ServePWAIcon` 函数（已在 Step 2 替换）**

确认文件中不再有名为 `ServePWAIcon` 的函数（仅保留 `ServePWAIconSized`）。

- [ ] **Step 4: 构建验证**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go build ./...
```
Expected: 无报错。

---

## Task 5: `UploadFavicon` 生成 PNG 变体

**Files:**
- Modify: `backend/internal/handler/site_setting_handler.go:62-115`

- [ ] **Step 1: 替换 `UploadFavicon`**

替换整个 `UploadFavicon` 函数为：
```go
// UploadFavicon handles favicon upload (admin only). Saves the original file
// for the <link rel="icon"> tag AND generates three PNG variants (192, 512,
// 512-maskable) used by the PWA manifest.
func (h *SiteSettingHandler) UploadFavicon(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MiB to give PNG variants headroom
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read whole upload into memory (max 10 MiB) — we need it twice: once for
	// the original save, once for PNG variant generation.
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, file); err != nil {
		http.Error(w, "Failed to read upload", http.StatusBadRequest)
		return
	}
	data := buf.Bytes()

	contentType := http.DetectContentType(data)
	ext := ".png"
	switch {
	case strings.Contains(contentType, "svg"):
		ext = ".svg"
	case strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg"):
		ext = ".jpg"
	case strings.Contains(contentType, "ico"):
		ext = ".ico"
	case strings.Contains(contentType, "gif"):
		ext = ".gif"
	}

	// Replace old favicon originals + any previously generated PWA variants.
	h.purgeFaviconFiles()

	// Save the original (used by <link rel="icon">).
	origPath := filepath.Join(h.siteDir, "favicon"+ext)
	if err := os.WriteFile(origPath, data, 0644); err != nil {
		http.Error(w, "Failed to save favicon", http.StatusInternalServerError)
		return
	}

	// Generate PWA PNG variants. If the upload isn't a decodable raster
	// (e.g. SVG/ICO), the manifest will fall back to the bundled defaults
	// (HasCustomFavicon stays false because pwa-icon-*.png won't exist).
	if _, err := imageutil.ProcessToPWAVariants(h.siteDir, bytes.NewReader(data)); err != nil {
		// Non-fatal: log via response field but don't fail the upload.
		fmt.Printf("site_setting: PWA variant generation failed: %v\n", err)
	}

	url := "/api/site-assets/favicon" + ext
	h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{Favicon: &url})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": url})
}

// purgeFaviconFiles removes any existing favicon* and pwa-icon-*.png from siteDir.
func (h *SiteSettingHandler) purgeFaviconFiles() {
	for _, pattern := range []string{"favicon*", "pwa-icon-*.png"} {
		old, _ := filepath.Glob(filepath.Join(h.siteDir, pattern))
		for _, f := range old {
			os.Remove(f)
		}
	}
}
```

在文件顶部 import 块加入：
```go
"bytes"
"fmt"
"github.com/alwaysking/akmdlibrary/internal/imageutil"
```

- [ ] **Step 2: 更新 `ResetFavicon`**

将 `ResetFavicon` 函数体改为：
```go
func (h *SiteSettingHandler) ResetFavicon(w http.ResponseWriter, r *http.Request) {
	h.purgeFaviconFiles()
	empty := ""
	h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{Favicon: &empty})
	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 3: 构建验证**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go build ./...
```
Expected: 无报错。

---

## Task 6: 注册新路由，删除旧 `pwa-icon`

**Files:**
- Modify: `backend/cmd/server/main.go:289-296`

- [ ] **Step 1: 替换路由块**

将：
```go
// IMPORTANT: `pwa-icon` must be registered before `{filename}` so chi matches it
r.Get("/api/site-assets/pwa-icon", siteSettingHandler.ServePWAIcon)

// Public PWA manifest (dynamic — reflects current site name + favicon)
r.Get("/api/manifest.webmanifest", siteSettingHandler.ServeManifest)
```
替换为：
```go
// IMPORTANT: literal paths must be registered before `{filename}` so chi matches them.
r.Get("/api/site-assets/pwa-icon-192.png", siteSettingHandler.ServePWAIconSizedStatic(192))
r.Get("/api/site-assets/pwa-icon-512.png", siteSettingHandler.ServePWAIconSizedStatic(512))
r.Get("/api/site-assets/pwa-icon-512-maskable.png", siteSettingHandler.ServePWAIconSizedStatic(512))

// Public PWA manifest (dynamic — reflects current site name + favicon)
r.Get("/api/manifest.webmanifest", siteSettingHandler.ServeManifest)
```

> 备注：`ServePWAIconSizedStatic(size int) http.HandlerFunc` 是闭包包装器，避免改 chi 路由风格。

- [ ] **Step 2: 在 handler 中补上闭包包装器**

在 `site_setting_handler.go` 末尾追加：
```go
// ServePWAIconSizedStatic returns an http.HandlerFunc that serves a specific
// PWA icon size — used by chi routes where the size is a literal in the URL.
func (h *SiteSettingHandler) ServePWAIconSizedStatic(sizeKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		size := sizeKey
		if sizeKey == "512-maskable" {
			size = "512-maskable"
		}
		fname := "pwa-icon-" + size + ".png"
		full := filepath.Join(h.siteDir, fname)
		if _, err := os.Stat(full); err != nil {
			static := map[string]string{
				"192":          "/icons/icon-192.png",
				"512":          "/icons/icon-512.png",
				"512-maskable": "/icons/icon-512-maskable.png",
			}[size]
			if static == "" {
				http.NotFound(w, r)
				return
			}
			http.Redirect(w, r, static, http.StatusFound)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, full)
	}
}
```

删除之前 `ServePWAIconSized(w, r)` 版本（不再需要 chi URLParam）。`"github.com/go-chi/chi/v5"` import 可以移除（若文件其他地方未用）。

- [ ] **Step 3: 构建并启动一次，curl 验证**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go build ./... && go vet ./...
```
Expected: 无报错。

---

## Task 7: 升级 Service Worker

**Files:**
- Modify: `frontend/public/sw.js`

- [ ] **Step 1: 重写 sw.js**

完整覆盖 `frontend/public/sw.js`：
```javascript
// PWA Service Worker — App Shell precache + stale-while-revalidate for static
// assets. API requests (/api/*) bypass the cache to avoid stale user data.

const CACHE_VERSION = 'akmdl-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // best-effort: addAll fails whole if one resource 404s, so add individually
    await Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin; let cross-origin pass through.
  if (url.origin !== self.location.origin) return;

  // API requests: network-only, no caching.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('/', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
```

---

## Task 8: `main.tsx` SW 更新流程

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: 替换 SW 注册块**

将 `frontend/src/main.tsx` 末尾的 SW 注册块替换为：
```typescript
// Register the PWA service worker (production only — HMR + SW don't mix).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          // New SW took over after skipWaiting — reload once to pick up new shell.
          navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
          window.location.reload();
        }
      });
    });
  }).catch((err) => {
    console.warn('SW registration failed:', err);
  });
}
```

并在 `sw.js` 中（已在 Task 7 已含 `skipWaiting`，再补一个 message 监听）：

`sw.js` 的 `install` 之后追加：
```javascript
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
```

---

## Task 9: `index.html` 补 iOS 兼容 meta

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: 替换 `<head>` 内容**

将 `<head>` 内的：
```html
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
<link rel="manifest" href="/api/manifest.webmanifest" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#ffffff" />
```
替换为：
```html
<link rel="icon" href="/icons/icon-192.png" />
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
<link rel="apple-touch-icon" href="/icons/icon-512.png" />
<link rel="mask-icon" href="/vite.svg" color="#4F46E5" />
<link rel="manifest" href="/api/manifest.webmanifest" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#ffffff" />
<meta name="description" content="MD Library — self-hosted markdown library" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="MD Library" />
<meta name="mobile-web-app-capable" content="yes" />
```

---

## Task 10: 前端构建验证

**Files:** 无（仅运行）

- [ ] **Step 1: 前端 build**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/frontend && npm run build
```
Expected: 构建成功；`dist/` 包含 `icons/icon-192.png`、`icons/icon-512.png`、`icons/icon-512-maskable.png`、`sw.js`。

- [ ] **Step 2: 校验 dist**

Run:
```bash
ls /Users/alwaysking/AKProject/AKMDLibrary/frontend/dist/icons/ && head -c 200 /Users/alwaysking/AKProject/AKMDLibrary/frontend/dist/sw.js
```
Expected: 三个 PNG 文���存在；`dist/sw.js` 已是新内容（带 `App Shell precache` 注释）。

---

## Task 11: 更新设计文档

**Files:**
- Modify: `docs/PWA-SUPPORT-DESIGN.md`

- [ ] **Step 1: 在文件顶部加变更说明**

在 `docs/PWA-SUPPORT-DESIGN.md` 第 1 行后插入：
```markdown
> **更新（2026-07-15）：** 方案已升级。原方案使用 `"sizes":"any"` + SVG 兜底图标，
> 触发 Chrome 已知 bug（[crbug 40925759](https://issuetracker.google.com/issues/40925759)），
> 浏览器不弹安装提示。现改为：
> - 默认图标随仓库分发（PNG 192/512/maskable 三档），由 `frontend/scripts/generate-pwa-icons.mjs` 生成
> - 上传 favicon 时后端用 `golang.org/x/image` 解码并烘焙三档 PNG
> - manifest 引用具体尺寸 PNG + `id` / `display_override` / `orientation` 字段
> - SW 升级为 App Shell 预缓存 + stale-while-revalidate（API 旁路）
> - 补 `apple-touch-icon` / `mask-icon` 等 iOS 兼容 meta
> 原文保留如下作为决策溯源。
```

---

## Task 12: 端到端冒烟验证（手工）

- [ ] **Step 1: 启动后端 + 前端 build**

Run:
```bash
cd /Users/alwaysking/AKProject/AKMDLibrary/backend && go build -o /tmp/akmdl-pwa-test ./cmd/server && AKMDL_DOCS_DIR=/tmp/akmdl-pwa-docs AKMDL_DATA_DIR=/tmp/akmdl-pwa-data AKMDL_FRONTEND_DIST=/Users/alwaysking/AKProject/AKMDLibrary/frontend/dist AKMDL_SITE_DIR=/tmp/akmdl-pwa-site AKMDL_PORT=7788 /tmp/akmdl-pwa-test
```
（若环境变量名不同，参照现有 main.go 读取的实际变量名）

- [ ] **Step 2: curl manifest 校验**

Run:
```bash
curl -s http://localhost:7788/api/manifest.webmanifest | python3 -m json.tool
```
Expected: JSON 输出包含 `icons` 数组，三个条目分别带 `"sizes": "192x192"`、`"512x512"`、`"512x512"` + `purpose: maskable`，`type` 均为 `image/png`。

- [ ] **Step 3: curl 默认图标**

Run:
```bash
curl -sI http://localhost:7788/icons/icon-192.png | head -5
```
Expected: `200 OK`，`Content-Type: image/png`。

- [ ] **Step 4: 浏览器手动验收**

打开 Chrome（需 HTTPS 或 localhost），访问 `http://localhost:7788/`：
1. DevTools → Application → Manifest：无报错，图标加载到位
2. DevTools → Application → Service Workers：`sw.js` activated
3. 地址栏右侧应出现安装图标（或菜单 → "安装 MD Library…"）
4. Application → Storage → Cache Storage：可见 `akmdl-v1` 含 `/`、`/index.html`、图标
5. 关闭网络 → 刷新首页：能打开（App Shell 离线可用）

- [ ] **Step 5: favicon 上传冒烟（可选）**

在管理员设置页上传一张 PNG/JPG，然后：
```bash
ls /tmp/akmdl-pwa-site/
```
Expected: 出现 `favicon.<ext>` + `pwa-icon-192.png` + `pwa-icon-512.png` + `pwa-icon-512-maskable.png`。

---

## 验收（subagent）

完成上述任务后，按用户工作流"实施与验证"第 2 步，启动 `code-reviewer` subagent 检查：
1. 代码质量（命名、错误处理、import 顺序）
2. 是否有遗漏（路由冲突、未删除旧 `ServePWAIcon`、`go.mod` 漂移）
3. 测试是否真覆盖关键路径（Decode/Resize/Maskable/ProcessToPWAVariants）
4. 前端 build 是否通过、SW 是否在 dist 中、icons 是否在 dist 中
5. 设计文档是否更新

如 subagent 不通过，根据反馈修改后再提交新 subagent 验收，循环直到通过。

## 提交策略

按用户附加要求：**不私自提交**。所有任务完成后向用户汇报，等待用户明确要求提交时再做：
1. 创建 patch 保留环境
2. 提交
3. 用 patch 复核是否有误删内容
