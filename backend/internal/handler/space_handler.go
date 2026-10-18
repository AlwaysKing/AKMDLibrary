package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type SpaceHandler struct {
	spaceService *service.SpaceService
	authService  *service.AuthService
	desktopMode  bool
}

func NewSpaceHandler(spaceService *service.SpaceService, authService *service.AuthService, desktopMode bool) *SpaceHandler {
	return &SpaceHandler{
		spaceService: spaceService,
		authService:  authService,
		desktopMode:  desktopMode,
	}
}

func rejectPersonalSpace(w http.ResponseWriter, slug string) bool {
	if model.IsPersonalSpaceSlug(slug) {
		http.Error(w, "Not found", http.StatusNotFound)
		return true
	}
	return false
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
	if rejectPersonalSpace(w, slug) {
		return
	}

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
	if req.SourcePath != "" || req.ImportMode != "" {
		user, err := h.authService.Me(userID)
		if err != nil || user.Role != "admin" {
			http.Error(w, "Admin required", http.StatusForbidden)
			return
		}
	}
	if err := validateSpaceImportRequest(&req, h.desktopMode); err != nil {
		if errors.Is(err, errDesktopOnly) {
			http.Error(w, err.Error(), http.StatusForbidden)
		} else {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	space, err := h.spaceService.Create(&req, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(space)
}

var errDesktopOnly = errors.New("local folder import is only available in the desktop app")

func validateSpaceImportRequest(req *model.CreateSpaceRequest, desktopMode bool) error {
	req.SourcePath = strings.TrimSpace(req.SourcePath)
	req.ImportMode = strings.TrimSpace(req.ImportMode)
	if req.SourcePath == "" && req.ImportMode == "" {
		return nil
	}
	if !desktopMode {
		return errDesktopOnly
	}
	if req.SourcePath == "" || req.ImportMode == "" {
		return errors.New("source_path and import_mode must be provided together")
	}
	if req.ImportMode != "copy" && req.ImportMode != "link" {
		return errors.New("import_mode must be copy or link")
	}
	if !filepath.IsAbs(req.SourcePath) {
		return errors.New("source_path must be absolute")
	}
	info, err := os.Stat(req.SourcePath)
	if err != nil {
		return errors.New("source_path does not exist")
	}
	if !info.IsDir() {
		return errors.New("source_path must be a directory")
	}
	return nil
}

func (h *SpaceHandler) Update(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if rejectPersonalSpace(w, slug) {
		return
	}

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
	if rejectPersonalSpace(w, slug) {
		return
	}

	if err := h.spaceService.Delete(slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *SpaceHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if rejectPersonalSpace(w, slug) {
		return
	}

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
	if rejectPersonalSpace(w, slug) {
		return
	}

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
	if rejectPersonalSpace(w, slug) {
		return
	}
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
	if rejectPersonalSpace(w, slug) {
		return
	}
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
	if rejectPersonalSpace(w, slug) {
		return
	}

	if err := h.spaceService.RefreshSpace(slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *SpaceHandler) UpdateFeatureFlags(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if rejectPersonalSpace(w, slug) {
		return
	}

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
