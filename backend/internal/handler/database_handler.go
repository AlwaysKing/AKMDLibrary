package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

type DatabaseHandler struct {
	databaseService *service.DatabaseService
	spaceService    *service.SpaceService
}

func NewDatabaseHandler(databaseService *service.DatabaseService, spaceService *service.SpaceService) *DatabaseHandler {
	return &DatabaseHandler{databaseService: databaseService, spaceService: spaceService}
}

func (h *DatabaseHandler) check(w http.ResponseWriter, r *http.Request, write bool) bool {
	slug := chi.URLParam(r, "slug")
	userID := middleware.GetUserID(r)
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return false
	}
	role, ok := h.spaceService.MemberRole(space.ID, userID)
	if !ok {
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}
	if write && role == "viewer" {
		http.Error(w, "Read only", http.StatusForbidden)
		return false
	}
	return true
}

func (h *DatabaseHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, false) {
		return
	}
	out, err := h.databaseService.List(chi.URLParam(r, "slug"))
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.CreateDatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.Create(chi.URLParam(r, "slug"), req)
	if err == nil {
		w.WriteHeader(http.StatusCreated)
	}
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) Get(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, false) {
		return
	}
	out, err := h.databaseService.Get(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"))
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) Update(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.UpdateDatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.UpdateMeta(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), req)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	err := h.databaseService.Delete(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *DatabaseHandler) AddColumn(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.CreateDatabaseColumnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.AddColumn(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), req)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) UpdateColumn(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.UpdateDatabaseColumnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.UpdateColumn(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "colId"), req)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) DeleteColumn(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	out, err := h.databaseService.DeleteColumn(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "colId"))
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) ReorderColumns(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.ReorderDatabaseColumnsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.ReorderColumns(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), req.ColumnIDs)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) ListRows(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, false) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	out, err := h.databaseService.ListRows(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), limit, offset)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) CreateRow(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.CreateDatabaseRowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.CreateRow(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), fmt.Sprintf("user:%d", middleware.GetUserID(r)), req.Values)
	if err == nil {
		w.WriteHeader(http.StatusCreated)
	}
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) GetRow(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, false) {
		return
	}
	out, err := h.databaseService.GetRow(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "rowId"))
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) UpdateRow(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.UpdateDatabaseRowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	out, err := h.databaseService.UpdateRow(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "rowId"), fmt.Sprintf("user:%d", middleware.GetUserID(r)), req.Values)
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) DeleteRow(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	err := h.databaseService.DeleteRow(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "rowId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *DatabaseHandler) GetRowPage(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, false) {
		return
	}
	out, err := h.databaseService.GetRowPage(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "rowId"))
	respondJSON(w, out, err)
}
func (h *DatabaseHandler) PutRowPage(w http.ResponseWriter, r *http.Request) {
	if !h.check(w, r, true) {
		return
	}
	var req model.UpdateDatabaseRowPageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	err := h.databaseService.PutRowPage(chi.URLParam(r, "slug"), chi.URLParam(r, "dbId"), chi.URLParam(r, "rowId"), req.Markdown)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func respondJSON(w http.ResponseWriter, v any, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
