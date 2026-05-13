package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/alwaysking/mdlibrary/internal/middleware"
	"github.com/alwaysking/mdlibrary/internal/service"
)

type UploadHandler struct {
	pageService *service.PageService
	uploadDir   string
	iconDir     string
}

func NewUploadHandler(pageService *service.PageService, uploadDir string, iconDir string) *UploadHandler {
	return &UploadHandler{
		pageService: pageService,
		uploadDir:   uploadDir,
		iconDir:     iconDir,
	}
}

func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	// Check if it's a multipart form
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10MB max
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// Get file
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Get page ID if provided
	pageIDStr := r.FormValue("page_id")
	var pageID int
	var slug string

	if pageIDStr != "" {
		pageID, err = strconv.Atoi(pageIDStr)
		if err != nil {
			http.Error(w, "Invalid page ID", http.StatusBadRequest)
			return
		}
		slug = r.FormValue("space_slug")
	}

	// Read file content
	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var filePath string
	if pageID > 0 && slug != "" {
		// Upload to page's public directory
		filePath, err = h.pageService.UploadAsset(slug, pageID, header.Filename, content)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		// Upload to system upload directory
		filePath = fmt.Sprintf("/api/upload/%s", header.Filename)
		uploadPath := filepath.Join(h.uploadDir, header.Filename)
		if err := os.WriteFile(uploadPath, content, 0644); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
	}

	// Add to icon library if requested
	if r.FormValue("add_to_library") == "true" {
		userID := middleware.GetUserID(r)
		iconName := r.FormValue("icon_name")
		if iconName == "" {
			iconName = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
		}
		ext := filepath.Ext(header.Filename)

		userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
		os.MkdirAll(userDir, 0755)

		iconPath := filepath.Join(userDir, iconName+ext)
		os.WriteFile(iconPath, content, 0644)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": filePath})
}

func (h *UploadHandler) ServeUpload(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Path[len("/api/upload/"):]
	if filename == "" {
		http.Error(w, "Filename required", http.StatusBadRequest)
		return
	}

	// Security check
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.uploadDir, filename)
	http.ServeFile(w, r, filePath)
}

// ListIcons returns all icons in the current user's icon library
func (h *UploadHandler) ListIcons(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))

	entries, err := os.ReadDir(userDir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]string{})
		return
	}

	icons := []map[string]string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		icons = append(icons, map[string]string{
			"name": name,
			"url":  "/api/icons/" + strconv.Itoa(userID) + "/" + name,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(icons)
}

// CheckIconName checks if an icon name already exists in the user's library
func (h *UploadHandler) CheckIconName(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	name := r.URL.Query().Get("name")
	if name == "" {
		json.NewEncoder(w).Encode(map[string]bool{"exists": false})
		return
	}

	userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
	entries, err := os.ReadDir(userDir)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]bool{"exists": false})
		return
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		// Compare name without extension
		existingName := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		if existingName == name {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]bool{"exists": true})
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"exists": false})
}

// UseIcon copies an icon from the library to the page's public directory and returns the asset path
func (h *UploadHandler) UseIcon(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		IconName  string `json:"icon_name"`
		PageID    int    `json:"page_id"`
		SpaceSlug string `json:"space_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.IconName == "" || req.PageID == 0 || req.SpaceSlug == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// Read the icon file from library
	iconPath := filepath.Join(h.iconDir, strconv.Itoa(userID), req.IconName)
	content, err := os.ReadFile(iconPath)
	if err != nil {
		http.Error(w, "Icon not found", http.StatusNotFound)
		return
	}

	// Copy to page's public directory
	assetPath, err := h.pageService.UploadAsset(req.SpaceSlug, req.PageID, req.IconName, content)
	if err != nil {
		http.Error(w, "Failed to copy icon", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": assetPath})
}

// ServeIcon serves an icon from the icon library (path: /api/icons/{userId}/{filename})
func (h *UploadHandler) ServeIcon(w http.ResponseWriter, r *http.Request) {
	// Path format: /api/icons/{userId}/{filename}
	sub := r.URL.Path[len("/api/icons/"):]
	if sub == "" {
		http.Error(w, "Filename required", http.StatusBadRequest)
		return
	}

	// Security check - only allow {number}/{name}
	if strings.Contains(sub, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	parts := strings.SplitN(sub, "/", 2)
	if len(parts) != 2 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.iconDir, parts[0], parts[1])
	http.ServeFile(w, r, filePath)
}
