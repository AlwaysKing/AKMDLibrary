package handler

import (
	"encoding/json"
	"net/http"

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
	result, err := h.personalService.CreateTodo(middleware.GetUserID(r), &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePersonalJSON(w, result)
}

func (h *PersonalHandler) UpdateTodo(w http.ResponseWriter, r *http.Request) {
	todoID := chi.URLParam(r, "id")
	if todoID == "" {
		http.Error(w, "Invalid todo id", http.StatusBadRequest)
		return
	}
	var req model.UpdatePersonalTodoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	todos, err := h.personalService.UpdateTodo(middleware.GetUserID(r), todoID, &req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePersonalJSON(w, todos)
}

func (h *PersonalHandler) DeleteTodo(w http.ResponseWriter, r *http.Request) {
	todoID := chi.URLParam(r, "id")
	if todoID == "" {
		http.Error(w, "Invalid todo id", http.StatusBadRequest)
		return
	}
	todos, err := h.personalService.DeleteTodo(middleware.GetUserID(r), todoID)
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
