package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/service"
)

type contextKey string

const (
	UserIDKey contextKey = "user_id"
)

type AuthMiddleware struct {
	authService *service.AuthService
}

func NewAuthMiddleware(authService *service.AuthService) *AuthMiddleware {
	return &AuthMiddleware{
		authService: authService,
	}
}

func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		debug := isPageDebugPath(r.URL.Path)
		start := time.Now()
		if debug {
			log.Printf("[page-debug] auth.RequireAuth start path=%s hasAuthorization=%t remote=%s", r.URL.Path, r.Header.Get("Authorization") != "", r.RemoteAddr)
		}
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			if debug {
				log.Printf("[page-debug] auth.RequireAuth missing-authorization path=%s elapsed=%s", r.URL.Path, time.Since(start))
			}
			http.Error(w, "Authorization header required", http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			if debug {
				log.Printf("[page-debug] auth.RequireAuth invalid-header path=%s elapsed=%s", r.URL.Path, time.Since(start))
			}
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		if debug {
			log.Printf("[page-debug] auth.RequireAuth before-VerifyToken path=%s tokenBytes=%d elapsed=%s", r.URL.Path, len(parts[1]), time.Since(start))
		}
		userID, err := m.authService.VerifyToken(parts[1])
		if err != nil {
			if debug {
				log.Printf("[page-debug] auth.RequireAuth VerifyToken-error path=%s err=%v elapsed=%s", r.URL.Path, err, time.Since(start))
			}
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}
		if debug {
			log.Printf("[page-debug] auth.RequireAuth VerifyToken-ok path=%s userID=%d elapsed=%s", r.URL.Path, userID, time.Since(start))
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
		if debug {
			log.Printf("[page-debug] auth.RequireAuth done path=%s userID=%d elapsed=%s", r.URL.Path, userID, time.Since(start))
		}
	})
}

func (m *AuthMiddleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header required", http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		userID, err := m.authService.VerifyToken(parts[1])
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Check if user is admin
		user, err := m.authService.Me(userID)
		if err != nil || user.Role != "admin" {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetUserID(r *http.Request) int {
	if userID, ok := r.Context().Value(UserIDKey).(int); ok {
		return userID
	}
	return 0
}

func isPageDebugPath(path string) bool {
	return strings.HasPrefix(path, "/api/spaces/") &&
		strings.Contains(path, "/pages/") &&
		!strings.Contains(path, "/pages/starred") &&
		!strings.Contains(path, "/pages/recent")
}
