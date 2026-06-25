package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type SpaceHandler struct {
	spaceService *service.SpaceService
	authService  *service.AuthService
}

func NewSpaceHandler(spaceService *service.SpaceService, authService *service.AuthService) *SpaceHandler {
	return &SpaceHandler{
		spaceService: spaceService,
		authService:  authService,
	}
}

func (h *SpaceHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	// Check if user is admin
	isAdmin := false
	user, err := h.authService.Me(userID)
	if err == nil && user.Role == "admin" {
		isAdmin = true
	}

	// Default: only show member spaces. ?all=true shows all (admin only).
	showAll := r.URL.Query().Get("all") == "true" && isAdmin

	spaces, err := h.spaceService.List(showAll, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(spaces)
}

func (h *SpaceHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(space)
}

func (h *SpaceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req model.CreateSpaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	userID := middleware.GetUserID(r)
	space, err := h.spaceService.Create(&req, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(space)
}

func (h *SpaceHandler) Update(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	var req model.UpdateSpaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	space, err := h.spaceService.Update(slug, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(space)
}

func (h *SpaceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	if err := h.spaceService.Delete(slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *SpaceHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	members, err := h.spaceService.ListMembers(space.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(members)
}

func (h *SpaceHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	var req model.AddMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	member, err := h.spaceService.AddMember(space.ID, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(member)
}

func (h *SpaceHandler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	memberIDStr := chi.URLParam(r, "id")

	memberID, err := strconv.Atoi(memberIDStr)
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	var req model.UpdateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	member, err := h.spaceService.UpdateMember(space.ID, memberID, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(member)
}

func (h *SpaceHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	memberIDStr := chi.URLParam(r, "id")

	memberID, err := strconv.Atoi(memberIDStr)
	if err != nil {
		http.Error(w, "Invalid member ID", http.StatusBadRequest)
		return
	}

	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if err := h.spaceService.RemoveMember(space.ID, memberID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *SpaceHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	if err := h.spaceService.RefreshSpace(slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *SpaceHandler) UpdateFeatureFlags(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	// Verify space exists
	if _, err := h.spaceService.GetBySlug(slug); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	var req model.FeatureFlags
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	flags, err := h.spaceService.UpdateFeatureFlags(slug, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"feature_flags": flags,
	})
}
