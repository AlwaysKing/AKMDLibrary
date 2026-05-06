package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type PageHandler struct {
	pageService *service.PageService
	spaceService *service.SpaceService
}

func NewPageHandler(pageService *service.PageService, spaceService *service.SpaceService) *PageHandler {
	return &PageHandler{
		pageService: pageService,
		spaceService: spaceService,
	}
}

func (h *PageHandler) GetTree(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	tree, err := h.pageService.GetTree(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Enrich tree with database IDs and metadata
	space, err := h.spaceService.GetBySlug(slug)
	if err == nil {
		h.pageService.EnrichTreeWithDB(tree, space.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

func (h *PageHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	pageIDStr := chi.URLParam(r, "id")

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	page, err := h.pageService.GetByID(slug, pageID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) Create(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) Update(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	pageIDStr := chi.URLParam(r, "id")

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

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
	pageIDStr := chi.URLParam(r, "id")

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

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
	pageIDStr := chi.URLParam(r, "id")

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	if err := h.pageService.Delete(slug, pageID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PageHandler) ServeAsset(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	pageIDStr := chi.URLParam(r, "id")

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

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
