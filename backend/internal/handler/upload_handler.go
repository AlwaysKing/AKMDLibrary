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
	coverDir    string
}

func NewUploadHandler(pageService *service.PageService, uploadDir string, iconDir string, coverDir string) *UploadHandler {
	return &UploadHandler{
		pageService: pageService,
		uploadDir:   uploadDir,
		iconDir:     iconDir,
		coverDir:    coverDir,
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
	pageID := r.FormValue("page_id")
	var slug string

	if pageID != "" {
		slug = r.FormValue("space_slug")
	}

	// Read file content
	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	var filePath string
	if pageID != "" && slug != "" {
		// Upload to page's public directory
		relativePath, uploadErr := h.pageService.UploadAsset(slug, pageID, header.Filename, content)
		if uploadErr != nil {
			http.Error(w, uploadErr.Error(), http.StatusInternalServerError)
			return
		}
		// Return the full serving URL so the frontend can use it directly
		filePath = fmt.Sprintf("/api/spaces/%s/pages/%s/assets/%s", slug, pageID, relativePath)
	} else {
		// Upload to system upload directory
		filePath = fmt.Sprintf("/api/upload/%s", header.Filename)
		uploadPath := filepath.Join(h.uploadDir, header.Filename)
		if err := os.WriteFile(uploadPath, content, 0644); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
	}

	userID := middleware.GetUserID(r)
	ext := filepath.Ext(header.Filename)

	// Add to icon library if requested
	if r.FormValue("add_to_library") == "true" {
		iconName := r.FormValue("icon_name")
		if iconName == "" {
			iconName = strings.TrimSuffix(header.Filename, ext)
		}

		userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
		os.MkdirAll(userDir, 0755)

		iconPath := filepath.Join(userDir, iconName+ext)
		os.WriteFile(iconPath, content, 0644)
	}

	// Add to cover library if requested
	if r.FormValue("add_to_cover_library") == "true" {
		coverName := r.FormValue("cover_name")
		if coverName == "" {
			coverName = strings.TrimSuffix(header.Filename, ext)
		}

		userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))
		os.MkdirAll(userDir, 0755)

		coverPath := filepath.Join(userDir, coverName+ext)
		os.WriteFile(coverPath, content, 0644)
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

// ==================== Icon Library ====================

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
		PageID    string `json:"page_id"`
		SpaceSlug string `json:"space_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.IconName == "" || req.PageID == "" || req.SpaceSlug == "" {
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

// ==================== Cover Library ====================

// ListCovers returns all covers in the current user's cover library
func (h *UploadHandler) ListCovers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))

	entries, err := os.ReadDir(userDir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]string{})
		return
	}

	covers := []map[string]string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		covers = append(covers, map[string]string{
			"name": name,
			"url":  "/api/covers/" + strconv.Itoa(userID) + "/" + name,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(covers)
}

// CheckCoverName checks if a cover name already exists in the user's library
func (h *UploadHandler) CheckCoverName(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	name := r.URL.Query().Get("name")
	if name == "" {
		json.NewEncoder(w).Encode(map[string]bool{"exists": false})
		return
	}

	userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))
	entries, err := os.ReadDir(userDir)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]bool{"exists": false})
		return
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
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

// UseCover copies a cover from the library to the page's public directory and returns the asset path
func (h *UploadHandler) UseCover(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		CoverName string `json:"cover_name"`
		PageID    string `json:"page_id"`
		SpaceSlug string `json:"space_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.CoverName == "" || req.PageID == "" || req.SpaceSlug == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	// Read the cover file from library
	coverPath := filepath.Join(h.coverDir, strconv.Itoa(userID), req.CoverName)
	content, err := os.ReadFile(coverPath)
	if err != nil {
		http.Error(w, "Cover not found", http.StatusNotFound)
		return
	}

	// Copy to page's public directory
	assetPath, err := h.pageService.UploadAsset(req.SpaceSlug, req.PageID, req.CoverName, content)
	if err != nil {
		http.Error(w, "Failed to copy cover", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": assetPath})
}

// ServeCover serves a cover from the cover library (path: /api/covers/{userId}/{filename})
func (h *UploadHandler) ServeCover(w http.ResponseWriter, r *http.Request) {
	// Path format: /api/covers/{userId}/{filename}
	sub := r.URL.Path[len("/api/covers/"):]
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

	filePath := filepath.Join(h.coverDir, parts[0], parts[1])
	http.ServeFile(w, r, filePath)
}

// ==================== Icon Library Management ====================

// UploadIcon handles POST /api/icons/upload — upload a file directly to icon library
func (h *UploadHandler) UploadIcon(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	userID := middleware.GetUserID(r)
	userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
	os.MkdirAll(userDir, 0755)

	iconName := r.FormValue("icon_name")
	ext := filepath.Ext(header.Filename)
	if iconName == "" {
		iconName = strings.TrimSuffix(header.Filename, ext)
	}

	// Check if name already exists
	targetPath := filepath.Join(userDir, iconName+ext)
	if _, err := os.Stat(targetPath); err == nil {
		http.Error(w, "Name already exists", http.StatusConflict)
		return
	}

	if err := os.WriteFile(targetPath, content, 0644); err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name": iconName + ext,
		"url":  "/api/icons/" + strconv.Itoa(userID) + "/" + iconName + ext,
	})
}

// DeleteIcon handles POST /api/icons/delete
func (h *UploadHandler) DeleteIcon(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Missing name", http.StatusBadRequest)
		return
	}

	// Security check
	if strings.Contains(req.Name, "..") || strings.Contains(req.Name, "/") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
	filePath := filepath.Join(userDir, req.Name)

	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Icon not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to delete", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RenameIcon handles PUT /api/icons/rename
func (h *UploadHandler) RenameIcon(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.OldName == "" || req.NewName == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	userDir := filepath.Join(h.iconDir, strconv.Itoa(userID))
	ext := filepath.Ext(req.OldName)
	newFileName := req.NewName + ext

	oldPath := filepath.Join(userDir, req.OldName)
	newPath := filepath.Join(userDir, newFileName)

	// Check if new name already exists
	if _, err := os.Stat(newPath); err == nil {
		http.Error(w, "Name already exists", http.StatusConflict)
		return
	}

	if err := os.Rename(oldPath, newPath); err != nil {
		http.Error(w, "Failed to rename", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name": newFileName,
		"url":  "/api/icons/" + strconv.Itoa(userID) + "/" + newFileName,
	})
}

// ==================== Cover Library Management ====================

// UploadCover handles POST /api/covers/upload — upload a file directly to cover library
func (h *UploadHandler) UploadCover(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	userID := middleware.GetUserID(r)
	userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))
	os.MkdirAll(userDir, 0755)

	coverName := r.FormValue("cover_name")
	ext := filepath.Ext(header.Filename)
	if coverName == "" {
		coverName = strings.TrimSuffix(header.Filename, ext)
	}

	// Check if name already exists
	targetPath := filepath.Join(userDir, coverName+ext)
	if _, err := os.Stat(targetPath); err == nil {
		http.Error(w, "Name already exists", http.StatusConflict)
		return
	}

	if err := os.WriteFile(targetPath, content, 0644); err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name": coverName + ext,
		"url":  "/api/covers/" + strconv.Itoa(userID) + "/" + coverName + ext,
	})
}

// DeleteCover handles POST /api/covers/delete
func (h *UploadHandler) DeleteCover(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Missing name", http.StatusBadRequest)
		return
	}

	// Security check
	if strings.Contains(req.Name, "..") || strings.Contains(req.Name, "/") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))
	filePath := filepath.Join(userDir, req.Name)

	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Cover not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to delete", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RenameCover handles PUT /api/covers/rename
func (h *UploadHandler) RenameCover(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.OldName == "" || req.NewName == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	userDir := filepath.Join(h.coverDir, strconv.Itoa(userID))
	ext := filepath.Ext(req.OldName)
	newFileName := req.NewName + ext

	oldPath := filepath.Join(userDir, req.OldName)
	newPath := filepath.Join(userDir, newFileName)

	// Check if new name already exists
	if _, err := os.Stat(newPath); err == nil {
		http.Error(w, "Name already exists", http.StatusConflict)
		return
	}

	if err := os.Rename(oldPath, newPath); err != nil {
		http.Error(w, "Failed to rename", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name": newFileName,
		"url":  "/api/covers/" + strconv.Itoa(userID) + "/" + newFileName,
	})
}
