package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

// FilesHandler manages the per-space shared file pool under <space>/_files/.
// Files in this directory can be referenced by fileContent blocks across all
// pages in the space; edits to those blocks write back here on page save.
type FilesHandler struct {
	docsDir      string
	spaceService *service.SpaceService
}

func NewFilesHandler(docsDir string, spaceService *service.SpaceService) *FilesHandler {
	// Normalize to absolute so filepath.Rel against Walk's absolute paths works.
	abs, err := filepath.Abs(docsDir)
	if err != nil {
		abs = docsDir
	}
	return &FilesHandler{docsDir: abs, spaceService: spaceService}
}

// fileItem is the JSON shape returned by List.
type fileItem struct {
	Path  string    `json:"path"` // path relative to space dir, e.g. _files/foo/bar.txt
	Name  string    `json:"name"` // base name
	Size  int64     `json:"size"`
	MTime time.Time `json:"mtime"`
}

// resolveFilesPath validates that rawPath stays inside the space's _files dir
// and returns the absolute filesystem path. rawPath may be:
//   - relative to space dir ("_files/foo.txt" or "foo.txt")
//   - just a base name ("foo.txt" -> _files/foo.txt)
//   - "_files" itself (returns the _files root)
func resolveFilesPath(docsDir, spaceSlug, rawPath string) (string, error) {
	cleaned := filepath.Clean(rawPath)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if strings.EqualFold(cleaned, "_files") {
		cleaned = "."
	} else if strings.HasPrefix(strings.ToLower(cleaned), "_files/") {
		cleaned = cleaned[len("_files/"):]
	}

	spaceDir := filepath.Join(docsDir, spaceSlug)
	filesRoot := filepath.Join(spaceDir, "_files")

	var abs string
	if cleaned == "." || cleaned == "" {
		abs = filesRoot
	} else {
		abs = filepath.Join(filesRoot, cleaned)
	}

	resolved, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	rootResolved, _ := filepath.Abs(filesRoot)
	if resolved != rootResolved &&
		!strings.HasPrefix(resolved+string(os.PathSeparator), rootResolved+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes _files")
	}
	return resolved, nil
}

// checkSpaceAccess replicates PageHandler's pattern.
func (h *FilesHandler) checkSpaceAccess(w http.ResponseWriter, r *http.Request, slug string) bool {
	userID := middleware.GetUserID(r)
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return false
	}
	if !h.spaceService.IsSpaceMember(space.ID, userID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}
	return true
}

// List handles GET /api/spaces/{slug}/files
func (h *FilesHandler) List(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	root, err := resolveFilesPath(h.docsDir, slug, "_files")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	items := []fileItem{}
	if _, statErr := os.Stat(root); os.IsNotExist(statErr) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)
		return
	}

	spaceDir := filepath.Join(h.docsDir, slug)
	err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(spaceDir, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		items = append(items, fileItem{
			Path:  rel,
			Name:  info.Name(),
			Size:  info.Size(),
			MTime: info.ModTime(),
		})
		return nil
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// GetContent handles GET /api/spaces/{slug}/files/content?path=...
func (h *FilesHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	abs, err := resolveFilesPath(h.docsDir, slug, rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// PutContent handles PUT /api/spaces/{slug}/files/content?path=...
// Body is the raw text content to write to the file. Used by fileContent
// blocks to persist edits back to _files/ independently from page.md.
// Creates parent directories as needed; creates the file if missing.
func (h *FilesHandler) PutContent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	abs, err := resolveFilesPath(h.docsDir, slug, rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	if mkErr := os.MkdirAll(filepath.Dir(abs), 0755); mkErr != nil {
		http.Error(w, "failed to create parent dir", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(abs, body, 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// Download handles GET /api/spaces/{slug}/files/download?path=...
func (h *FilesHandler) Download(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	abs, err := resolveFilesPath(h.docsDir, slug, rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if info.IsDir() {
		http.Error(w, "is a directory", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", info.Name()))
	http.ServeFile(w, r, abs)
}

// CheckName handles GET /api/spaces/{slug}/files/check?name=...
// Returns {available: bool}. name is the base filename; the caller uploads to
// _files/<name> (optionally under a subdir which is checked separately).
func (h *FilesHandler) CheckName(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "missing name", http.StatusBadRequest)
		return
	}
	available := true
	if strings.ContainsAny(name, "/\\") || name == "." || name == ".." || strings.Contains(name, "..") {
		available = false
	} else {
		abs, err := resolveFilesPath(h.docsDir, slug, name)
		if err != nil {
			available = false
		} else if _, statErr := os.Stat(abs); statErr == nil {
			available = false
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"available": available})
}

// Upload handles POST /api/spaces/{slug}/files/upload
// Accepts multipart form:
//   - file: the file content
//   - subdir (optional): subdirectory under _files to place the file
//
// Final path: _files/<subdir>/<original-filename>. Conflict => 409.
func (h *FilesHandler) Upload(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "failed to parse form", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "no file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "failed to read file", http.StatusInternalServerError)
		return
	}

	subdir := strings.TrimSpace(r.FormValue("subdir"))
	subdir = strings.TrimPrefix(subdir, "/")
	subdir = strings.TrimSuffix(subdir, "/")
	if subdir != "" {
		for _, seg := range strings.Split(subdir, "/") {
			if seg == "" || seg == "." || seg == ".." {
				http.Error(w, "invalid subdir", http.StatusBadRequest)
				return
			}
		}
	}

	relPath := filepath.Join("_files", subdir, header.Filename)
	abs, err := resolveFilesPath(h.docsDir, slug, relPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if _, statErr := os.Stat(abs); statErr == nil {
		http.Error(w, "name already exists", http.StatusConflict)
		return
	}

	if mkErr := os.MkdirAll(filepath.Dir(abs), 0755); mkErr != nil {
		http.Error(w, "failed to create directory", http.StatusInternalServerError)
		return
	}

	if writeErr := os.WriteFile(abs, content, 0644); writeErr != nil {
		http.Error(w, "failed to save file", http.StatusInternalServerError)
		return
	}

	relForClient := filepath.ToSlash(relPath)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"path": relForClient,
		"name": header.Filename,
	})
}

// Rename handles PUT /api/spaces/{slug}/files/rename
// body: {from: "_files/a.txt", to: "_files/b.txt"}
func (h *FilesHandler) Rename(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.From == "" || req.To == "" {
		http.Error(w, "missing from/to", http.StatusBadRequest)
		return
	}
	fromAbs, err := resolveFilesPath(h.docsDir, slug, req.From)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	toAbs, err := resolveFilesPath(h.docsDir, slug, req.To)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, statErr := os.Stat(fromAbs); os.IsNotExist(statErr) {
		http.Error(w, "source not found", http.StatusNotFound)
		return
	}
	if _, statErr := os.Stat(toAbs); statErr == nil {
		http.Error(w, "target already exists", http.StatusConflict)
		return
	}
	if mkErr := os.MkdirAll(filepath.Dir(toAbs), 0755); mkErr != nil {
		http.Error(w, "failed to create target dir", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	spaceDir := filepath.Join(h.docsDir, slug)
	rel, _ := filepath.Rel(spaceDir, toAbs)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"path": filepath.ToSlash(rel),
	})
}

// Delete handles DELETE /api/spaces/{slug}/files?path=...
func (h *FilesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	rawPath := r.URL.Query().Get("path")
	if rawPath == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	abs, err := resolveFilesPath(h.docsDir, slug, rawPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if _, statErr := os.Stat(abs); os.IsNotExist(statErr) {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	if err := os.Remove(abs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
