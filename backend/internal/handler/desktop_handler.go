package handler

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/service"
)

type DesktopHandler struct {
	authService *service.AuthService
}

func NewDesktopHandler(authService *service.AuthService) *DesktopHandler {
	return &DesktopHandler{authService: authService}
}

// ChooseFolder opens the native macOS folder picker for the desktop app.
func (h *DesktopHandler) ChooseFolder(w http.ResponseWriter, r *http.Request) {
	user, err := h.authService.Me(middleware.GetUserID(r))
	if err != nil || user.Role != "admin" {
		http.Error(w, "Admin required", http.StatusForbidden)
		return
	}
	if runtime.GOOS != "darwin" {
		http.Error(w, "Folder picker is only available on macOS", http.StatusNotImplemented)
		return
	}

	cmd := exec.CommandContext(r.Context(), "osascript", "-e", `POSIX path of (choose folder with prompt "选择空间文件夹")`)
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{"cancelled": true})
			return
		}
		http.Error(w, "Failed to open folder picker: "+err.Error(), http.StatusInternalServerError)
		return
	}

	path := strings.TrimSpace(string(output))
	if path == "" {
		http.Error(w, "Folder picker returned an empty path", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"path": path})
}
