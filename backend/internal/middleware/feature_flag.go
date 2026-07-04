package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

// FeatureFlagMiddleware holds dependencies for feature-flag gating middleware.
type FeatureFlagMiddleware struct {
	spaceService *service.SpaceService
}

func NewFeatureFlagMiddleware(spaceService *service.SpaceService) *FeatureFlagMiddleware {
	return &FeatureFlagMiddleware{spaceService: spaceService}
}

// RequireGitFeature returns 403 when the space's feature_flags.git is false.
// Resolves the space from the URL's {slug} param.
func (m *FeatureFlagMiddleware) RequireGitFeature(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		if slug == "" {
			http.Error(w, "slug required", http.StatusBadRequest)
			return
		}

		space, err := m.spaceService.GetBySlug(slug)
		if err != nil {
			http.Error(w, "space not found", http.StatusNotFound)
			return
		}

		flags := space.ParseFeatureFlags()
		if !flags.Git {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "git feature disabled for this space",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireClaudeFeature returns 403 when the space's feature_flags.claude is false.
// Resolves the space from the URL's {slug} param.
func (m *FeatureFlagMiddleware) RequireClaudeFeature(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		if slug == "" {
			http.Error(w, "slug required", http.StatusBadRequest)
			return
		}

		space, err := m.spaceService.GetBySlug(slug)
		if err != nil {
			http.Error(w, "space not found", http.StatusNotFound)
			return
		}

		flags := space.ParseFeatureFlags()
		if !flags.Claude {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "claude feature disabled for this space",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
