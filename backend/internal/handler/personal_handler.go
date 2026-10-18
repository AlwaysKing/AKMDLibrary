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

type PersonalHandler struct {
	personalService *service.PersonalService
}

func NewPersonalHandler(personalService *service.PersonalService) *PersonalHandler {
	return &PersonalHandler{personalService: personalService}
}

func (h *PersonalHandler) Overview(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	overview, err := h.personalService.Overview(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writePersonalJSON(w, overview)
}

func (h *PersonalHandler) CreateTodo(w http.ResponseWriter, r *http.Request) {
	var req model.CreatePersonalTodoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	todos, err := h.personalService.CreateTodo(middleware.GetUserID(r), req.Text)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePersonalJSON(w, todos)
}

func (h *PersonalHandler) UpdateTodo(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	if err != nil || index < 0 {
		http.Error(w, "Invalid todo index", http.StatusBadRequest)
		return
	}
	var req model.UpdatePersonalTodoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	todos, err := h.personalService.UpdateTodo(middleware.GetUserID(r), index, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePersonalJSON(w, todos)
}

func (h *PersonalHandler) DeleteTodo(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	if err != nil || index < 0 {
		http.Error(w, "Invalid todo index", http.StatusBadRequest)
		return
	}
	todos, err := h.personalService.DeleteTodo(middleware.GetUserID(r), index)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePersonalJSON(w, todos)
}

func (h *PersonalHandler) CreateNote(w http.ResponseWriter, r *http.Request) {
	var req model.CreatePersonalNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	page, err := h.personalService.CreateNote(middleware.GetUserID(r), req.Title, req.ParentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(page)
}

func (h *PersonalHandler) DeleteNote(w http.ResponseWriter, r *http.Request) {
	if err := h.personalService.DeleteNote(middleware.GetUserID(r), chi.URLParam(r, "id")); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writePersonalJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
