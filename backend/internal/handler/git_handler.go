package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

// maxOutputLen caps the push/pull stdout we send back to the client. Git can
// produce megabytes of progress text on a large pull, which would balloon the
// JSON response and the UI. Truncate with a clear marker.
const maxOutputLen = 4096

// GitHandler exposes per-space git operations to the frontend.
type GitHandler struct {
	gitService   *service.GitService
	spaceService *service.SpaceService
}

func NewGitHandler(gitService *service.GitService, spaceService *service.SpaceService) *GitHandler {
	return &GitHandler{gitService: gitService, spaceService: spaceService}
}

// checkSpaceAccess mirrors PageHandler.checkSpaceAccess: verifies the user is
// a member of the space. All users (including admin) must be members to touch
// git state — otherwise any logged-in user could read another space's file
// list via status or push malicious commits.
func (h *GitHandler) checkSpaceAccess(w http.ResponseWriter, r *http.Request, slug string) bool {
	userID := middleware.GetUserID(r)
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return false
	}
	if !h.spaceService.IsSpaceMember(space.ID, userID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}
	return true
}

// State returns the current git state of a space. If the space directory isn't
// a git repo, IsRepo is false and the frontend should hide the Git UI.
// GET /api/spaces/{slug}/git/state
func (h *GitHandler) State(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	state, err := h.gitService.State(slug)
	if err != nil {
		http.Error(w, service.PublicGitError(err), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// Commit stages the selected paths and creates a commit.
// POST /api/spaces/{slug}/git/commit  body: { message, paths }
func (h *GitHandler) Commit(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var req struct {
		Message string   `json:"message"`
		Paths   []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.gitService.Commit(slug, req.Message, req.Paths); err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Restore discards selected paths' worktree changes (tracked files revert to
// HEAD; untracked files are removed). Returns the refreshed state.
// POST /api/spaces/{slug}/git/restore  body: { paths }
func (h *GitHandler) Restore(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	state, err := h.gitService.Restore(slug, req.Paths)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// Push pushes the current branch upstream.
// POST /api/spaces/{slug}/git/push
func (h *GitHandler) Push(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	out, err := h.gitService.Push(slug)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": truncateOutput(out)})
}

// Pull fetches and merges from upstream.
// POST /api/spaces/{slug}/git/pull
func (h *GitHandler) Pull(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	out, err := h.gitService.Pull(slug)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": truncateOutput(out)})
}

// GetConfig returns the auto-commit config for the space.
// GET /api/spaces/{slug}/git/config
func (h *GitHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	cfg, err := h.gitService.GetConfig(slug)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// SetConfig updates the auto-commit config.
// PUT /api/spaces/{slug}/git/config  body: GitSyncConfig
func (h *GitHandler) SetConfig(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var cfg service.GitSyncConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.gitService.SetConfig(slug, cfg); err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// GetCredential returns metadata about the stored credential for the space.
// NEVER returns the secret itself. Admin-only — credential management is a
// server-level operation, not a per-member one.
// GET /api/spaces/{slug}/git/credentials
func (h *GitHandler) GetCredential(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	writeJSON(w, http.StatusOK, h.gitService.CredentialMeta(slug))
}

// SetCredential stores (or clears, with type="none") the git credential for
// the space. Admin-only.
// PUT /api/spaces/{slug}/git/credentials  body: CredentialInput
func (h *GitHandler) SetCredential(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	var in service.CredentialInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.gitService.SetCredential(slug, in); err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h.gitService.CredentialMeta(slug))
}

// DeleteCredential removes the stored credential.
// DELETE /api/spaces/{slug}/git/credentials
func (h *GitHandler) DeleteCredential(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if !h.checkSpaceAccess(w, r, slug) {
		return
	}
	if err := h.gitService.DeleteCredential(slug); err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h.gitService.CredentialMeta(slug))
}

// --- helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func truncateOutput(s string) string {
	if len(s) <= maxOutputLen {
		return s
	}
	return s[:maxOutputLen] + "\n... (truncated)"
}

// writeGitError maps a service error to an HTTP status using sentinel errors,
// and always sends a safe, non-revealing message to the client. The full
// internal error (with raw git stderr) is logged server-side so operators can
// debug — the client only ever sees the sanitized public message.
func writeGitError(w http.ResponseWriter, err error) {
	public := service.PublicGitError(err)
	// Log full error server-side. For git failures this includes the actual
	// git stderr (which may contain clues like "Permission denied (publickey)",
	// "Host key verification failed", etc.) — never credentials themselves.
	log.Printf("[git-handler] error: %v", err)
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, service.ErrSpaceNotFound):
		status = http.StatusNotFound
	case errors.Is(err, service.ErrNotAGitRepo):
		status = http.StatusBadRequest
	case errors.Is(err, service.ErrNoRemote):
		status = http.StatusBadRequest
	case strings.Contains(public, "commit message required"),
		strings.Contains(public, "no files selected"),
		strings.Contains(public, "invalid mode"),
		strings.Contains(public, "must be >="),
		strings.Contains(public, "invalid path"),
		strings.Contains(public, "invalid characters"),
		strings.Contains(public, "absolute path not allowed"),
		strings.Contains(public, "path escapes repo root"),
		strings.Contains(public, "nothing to commit"):
		status = http.StatusBadRequest
	case strings.Contains(public, "remote authentication failed"):
		status = http.StatusUnauthorized
	}
	http.Error(w, public, status)
}
