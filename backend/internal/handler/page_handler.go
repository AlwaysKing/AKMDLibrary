package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type PageHandler struct {
	pageService  *service.PageService
	spaceService *service.SpaceService
	authService  *service.AuthService
}

func NewPageHandler(pageService *service.PageService, spaceService *service.SpaceService, authService *service.AuthService) *PageHandler {
	return &PageHandler{
		pageService:  pageService,
		spaceService: spaceService,
		authService:  authService,
	}
}

// checkSpaceAccess verifies the user is a member of the given space.
// All users (including admin) must be space members to access content.
func (h *PageHandler) checkSpaceAccess(w http.ResponseWriter, r *http.Request, slug string) bool {
	start := time.Now()
	userID := middleware.GetUserID(r)
	debug := strings.HasPrefix(r.URL.Path, "/api/spaces/") && strings.Contains(r.URL.Path, "/pages/")
	if debug {
		log.Printf("[page-debug] checkSpaceAccess start slug=%s userID=%d path=%s", slug, userID, r.URL.Path)
		log.Printf("[page-debug] checkSpaceAccess before-GetBySlug slug=%s userID=%d elapsed=%s", slug, userID, time.Since(start))
	}

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		if debug {
			log.Printf("[page-debug] checkSpaceAccess GetBySlug-error slug=%s userID=%d err=%v elapsed=%s", slug, userID, err, time.Since(start))
		}
		http.Error(w, "Space not found", http.StatusNotFound)
		return false
	}
	if debug {
		log.Printf("[page-debug] checkSpaceAccess after-GetBySlug slug=%s spaceID=%d userID=%d elapsed=%s", slug, space.ID, userID, time.Since(start))
		log.Printf("[page-debug] checkSpaceAccess before-IsSpaceMember slug=%s spaceID=%d userID=%d elapsed=%s", slug, space.ID, userID, time.Since(start))
	}

	if !h.spaceService.IsSpaceMember(space.ID, userID) {
		if debug {
			log.Printf("[page-debug] checkSpaceAccess IsSpaceMember-denied slug=%s spaceID=%d userID=%d elapsed=%s", slug, space.ID, userID, time.Since(start))
		}
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}
	if debug {
		log.Printf("[page-debug] checkSpaceAccess ok slug=%s spaceID=%d userID=%d elapsed=%s", slug, space.ID, userID, time.Since(start))
	}

	return true
}

func (h *PageHandler) GetTree(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	tree, err := h.pageService.GetTree(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Enrich tree with database IDs and metadata
	h.pageService.EnrichTreeWithDB(slug, tree)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

func (h *PageHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	slug := chi.URLParam(r, "slug")
	pageID := chi.URLParam(r, "id")
	log.Printf("[page-debug] handler.GetByID start slug=%s pageID=%s remote=%s", slug, pageID, r.RemoteAddr)
	if !h.checkSpaceAccess(w, r, slug) {
		log.Printf("[page-debug] handler.GetByID access-denied-or-space-missing slug=%s pageID=%s elapsed=%s", slug, pageID, time.Since(start))
		return
	}
	log.Printf("[page-debug] handler.GetByID access-ok slug=%s pageID=%s elapsed=%s", slug, pageID, time.Since(start))

	page, err := h.pageService.GetByID(slug, pageID)
	if err != nil {
		log.Printf("[page-debug] handler.GetByID service-error slug=%s pageID=%s err=%v elapsed=%s", slug, pageID, err, time.Since(start))
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	log.Printf("[page-debug] handler.GetByID service-ok slug=%s pageID=%s filePath=%s contentBytes=%d elapsed=%s", slug, pageID, page.FilePath, len(page.Content), time.Since(start))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(page); err != nil {
		log.Printf("[page-debug] handler.GetByID encode-error slug=%s pageID=%s err=%v elapsed=%s", slug, pageID, err, time.Since(start))
		return
	}
	log.Printf("[page-debug] handler.GetByID done slug=%s pageID=%s elapsed=%s", slug, pageID, time.Since(start))
}

func (h *PageHandler) Create(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	var req model.CreatePageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		http.Error(w, "Title is required", http.StatusBadRequest)
		return
	}

	// Get space ID
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return
	}

	page, err := h.pageService.Create(slug, &req, space.ID)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") {
			http.Error(w, errMsg, http.StatusBadRequest)
		} else {
			http.Error(w, errMsg, http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) Update(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	pageID := chi.URLParam(r, "id")

	var req model.UpdatePageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	page, err := h.pageService.Update(slug, pageID, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) UpdateMeta(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	pageID := chi.URLParam(r, "id")

	var req model.UpdatePageMetaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	page, err := h.pageService.UpdateMeta(slug, pageID, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	pageID := chi.URLParam(r, "id")

	if err := h.pageService.Delete(slug, pageID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PageHandler) ServeAsset(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	pageID := chi.URLParam(r, "id")

	// Extract asset path from the wildcard: /api/spaces/:slug/pages/:id/assets/*
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// Find "assets" in the path and take everything after it
	assetIdx := -1
	for i, p := range parts {
		if p == "assets" {
			assetIdx = i
			break
		}
	}
	if assetIdx == -1 || assetIdx+1 >= len(parts) {
		http.Error(w, "Invalid asset path", http.StatusBadRequest)
		return
	}
	assetPath := strings.Join(parts[assetIdx+1:], "/")

	filePath, err := h.pageService.GetAssetPath(slug, pageID, assetPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	http.ServeFile(w, r, filePath)
}

// Duplicate handles POST /api/spaces/{slug}/pages/{id}/duplicate
func (h *PageHandler) Duplicate(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	pageID := chi.URLParam(r, "id")

	var req struct {
		TargetParentID *string `json:"target_parent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return
	}

	page, err := h.pageService.Duplicate(slug, pageID, req.TargetParentID, space.ID)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") {
			http.Error(w, errMsg, http.StatusNotFound)
		} else {
			http.Error(w, errMsg, http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(page)
}

// RestoreByPageID handles POST /api/spaces/{slug}/pages/{id}/restore
// Restores a trashed page by its frontmatter ID (used by undo).
func (h *PageHandler) RestoreByPageID(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	pageID := chi.URLParam(r, "id")

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return
	}

	page, err := h.pageService.RestoreByPageID(slug, pageID, space.ID)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") {
			http.Error(w, errMsg, http.StatusNotFound)
		} else {
			http.Error(w, errMsg, http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

// Move handles PUT /api/spaces/{slug}/pages/{id}/move
func (h *PageHandler) Move(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	pageID := chi.URLParam(r, "id")

	var req struct {
		TargetParentID *string `json:"target_parent_id"`
		AfterID        *string `json:"after_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	page, err := h.pageService.Move(slug, pageID, req.TargetParentID, req.AfterID)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not found") || strings.Contains(errMsg, "cannot") {
			http.Error(w, errMsg, http.StatusBadRequest)
		} else {
			http.Error(w, errMsg, http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

// ListStarred handles GET /api/spaces/{slug}/pages/starred
func (h *PageHandler) ListStarred(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	pages, err := h.pageService.ListStarred(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pages)
}

// ListRecent handles GET /api/spaces/{slug}/pages/recent
func (h *PageHandler) ListRecent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}

	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	pages, err := h.pageService.ListRecent(slug, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pages)
}
