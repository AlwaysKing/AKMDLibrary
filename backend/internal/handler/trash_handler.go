package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *PageHandler) ListTrash(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	items, err := h.pageService.ListTrash(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (h *PageHandler) RestoreFromTrash(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return
	}

	var req struct {
		TrashPath string `json:"trash_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	page, err := h.pageService.RestoreFromTrash(slug, req.TrashPath, space.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

func (h *PageHandler) PermanentDelete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	var req struct {
		TrashPath string `json:"trash_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if err := h.pageService.PermanentDelete(slug, req.TrashPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
