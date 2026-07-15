package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/imageutil"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
)

type SiteSettingHandler struct {
	siteSettingService *service.SiteSettingService
	siteDir            string
}

func NewSiteSettingHandler(siteSettingService *service.SiteSettingService, siteDir string) *SiteSettingHandler {
	os.MkdirAll(siteDir, 0755)
	return &SiteSettingHandler{
		siteSettingService: siteSettingService,
		siteDir:            siteDir,
	}
}

// Get returns site settings (public - no auth required)
func (h *SiteSettingHandler) Get(w http.ResponseWriter, r *http.Request) {
	settings, err := h.siteSettingService.Get()
	if err != nil {
		http.Error(w, "Failed to get site settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// UpdateSiteName updates site name (admin only)
func (h *SiteSettingHandler) UpdateSiteName(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SiteName string `json:"site_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{
		SiteName: &req.SiteName,
	}); err != nil {
		http.Error(w, "Failed to update site name", http.StatusInternalServerError)
		return
	}

	settings, _ := h.siteSettingService.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// UploadFavicon handles favicon upload (admin only). Saves the original file
// for the <link rel="icon"> tag AND generates three PNG variants (192, 512,
// 512-maskable) used by the PWA manifest. If the upload isn't a decodable
// raster (e.g. SVG/ICO), PWA variants are skipped and the manifest keeps
// pointing at the bundled defaults.
func (h *SiteSettingHandler) UploadFavicon(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MiB headroom for variant generation
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read once into memory — we need it for both the original save and PNG variants.
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

	origPath := filepath.Join(h.siteDir, "favicon"+ext)
	if err := os.WriteFile(origPath, data, 0644); err != nil {
		http.Error(w, "Failed to save favicon", http.StatusInternalServerError)
		return
	}

	// Generate PWA PNG variants. Non-fatal on failure — manifest will fall back
	// to bundled defaults via HasCustomFavicon() returning false.
	if _, err := imageutil.ProcessToPWAVariants(h.siteDir, bytes.NewReader(data)); err != nil {
		log.Printf("site_setting: PWA variant generation failed: %v", err)
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

// UploadLogo handles logo upload (admin only)
func (h *SiteSettingHandler) UploadLogo(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	contentType := http.DetectContentType(buf[:n])

	ext := ".png"
	if strings.Contains(contentType, "svg") {
		ext = ".svg"
	} else if strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg") {
		ext = ".jpg"
	} else if strings.Contains(contentType, "ico") {
		ext = ".ico"
	} else if strings.Contains(contentType, "gif") {
		ext = ".gif"
	}

	// Remove old logo files
	oldFiles, _ := filepath.Glob(filepath.Join(h.siteDir, "logo*"))
	for _, f := range oldFiles {
		os.Remove(f)
	}

	filePath := filepath.Join(h.siteDir, "logo"+ext)
	dst, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	dst.Write(buf[:n])
	io.Copy(dst, file)

	url := "/api/site-assets/logo" + ext
	h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{Logo: &url})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": url})
}

// ResetFavicon removes custom favicon + generated PWA variants (admin only)
func (h *SiteSettingHandler) ResetFavicon(w http.ResponseWriter, r *http.Request) {
	h.purgeFaviconFiles()
	empty := ""
	h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{Favicon: &empty})
	w.WriteHeader(http.StatusNoContent)
}

// ResetLogo removes custom logo (admin only)
func (h *SiteSettingHandler) ResetLogo(w http.ResponseWriter, r *http.Request) {
	oldFiles, _ := filepath.Glob(filepath.Join(h.siteDir, "logo*"))
	for _, f := range oldFiles {
		os.Remove(f)
	}
	empty := ""
	h.siteSettingService.Update(&model.UpdateSiteSettingsRequest{Logo: &empty})
	w.WriteHeader(http.StatusNoContent)
}

// ServeAsset serves site asset files (public)
func (h *SiteSettingHandler) ServeAsset(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Path
	// Prevent directory traversal
	name = filepath.Base(name)

	filePath := filepath.Join(h.siteDir, name)
	if info, err := os.Stat(filePath); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	// Set cache control
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filePath)
}

// GetFaviconPath returns the current favicon file path for dynamic serving
func (h *SiteSettingHandler) GetFaviconPath() string {
	pattern := filepath.Join(h.siteDir, "favicon.*")
	matches, _ := filepath.Glob(pattern)
	if len(matches) > 0 {
		return matches[0]
	}
	return ""
}

// GetLogoPath returns the current logo file path for dynamic serving
func (h *SiteSettingHandler) GetLogoPath() string {
	pattern := filepath.Join(h.siteDir, "logo.*")
	matches, _ := filepath.Glob(pattern)
	if len(matches) > 0 {
		return matches[0]
	}
	return ""
}

// ServeManifest returns a PWA Web App Manifest reflecting current site settings (public).
// Uses concrete PNG sizes (192/512/maskable) — Chrome rejects SVG with sizes:"any"
// (see https://issuetracker.google.com/issues/40925759). Icon URLs switch between
// the bundled defaults and admin-uploaded PNGs depending on whether a custom
// favicon is configured.
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

	icon192, icon512, iconMask := h.pwaIconURLs()

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
	// Manifest 在站点设置变更后必须及时生效，禁用强制缓存，允许每次重新验证。
	w.Header().Set("Cache-Control", "no-cache")
	if err := json.NewEncoder(w).Encode(manifest); err != nil {
		http.Error(w, "Failed to encode manifest", http.StatusInternalServerError)
		return
	}
}

// shortNameFrom truncates name to ≤12 runes (Chrome recommendation) so the
// home-screen icon label doesn't get truncated by the OS.
func shortNameFrom(name string) string {
	runes := []rune(name)
	if len(runes) <= 12 {
		return name
	}
	return string(runes[:12])
}

// pwaIconURLs returns the three icon URLs the manifest should reference. When
// admin-uploaded PWA variants exist in siteDir, they're served from /api/site-assets/;
// otherwise the manifest falls back to the bundled defaults under /icons/.
func (h *SiteSettingHandler) pwaIconURLs() (string, string, string) {
	if h.HasCustomFavicon() {
		return "/api/site-assets/pwa-icon-192.png",
			"/api/site-assets/pwa-icon-512.png",
			"/api/site-assets/pwa-icon-512-maskable.png"
	}
	return "/icons/icon-192.png",
		"/icons/icon-512.png",
		"/icons/icon-512-maskable.png"
}

// HasCustomFavicon reports whether the admin has uploaded a custom favicon
// AND the PWA PNG variants were successfully generated for it.
func (h *SiteSettingHandler) HasCustomFavicon() bool {
	matches, _ := filepath.Glob(filepath.Join(h.siteDir, "pwa-icon-512.png"))
	return len(matches) > 0
}

// ServePWAIconSizedStatic returns an http.HandlerFunc that serves a specific
// PWA icon size. Used by chi routes where the size is a literal in the URL.
// Falls back to the bundled default via 302 redirect when the generated file
// is missing (e.g. operator deleted it mid-flight).
func (h *SiteSettingHandler) ServePWAIconSizedStatic(sizeKey string) http.HandlerFunc {
	staticMap := map[string]string{
		"192":          "/icons/icon-192.png",
		"512":          "/icons/icon-512.png",
		"512-maskable": "/icons/icon-512-maskable.png",
	}
	return func(w http.ResponseWriter, r *http.Request) {
		fname := "pwa-icon-" + sizeKey + ".png"
		full := filepath.Join(h.siteDir, fname)
		if _, err := os.Stat(full); err != nil {
			static := staticMap[sizeKey]
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
