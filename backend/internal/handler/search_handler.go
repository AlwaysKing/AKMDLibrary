package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/go-chi/chi/v5"
)

// SearchHandler streams per-space search results as NDJSON (one JSON object
// per line). Each line is flushed immediately so the frontend can render
// matches progressively as the walker finds them.
type SearchHandler struct {
	searchService *service.SearchService
	spaceService  *service.SpaceService
}

func NewSearchHandler(searchService *service.SearchService, spaceService *service.SpaceService) *SearchHandler {
	return &SearchHandler{searchService: searchService, spaceService: spaceService}
}

// Stream handles GET /api/spaces/{slug}/search/stream?q=&subtree=&mode=title|all
//
// Response:
//   Content-Type: application/x-ndjson
//   Transfer-Encoding: chunked
//
// Body: one SearchHit JSON object per line. Client splits on "\n" and parses.
// The request's context (cancelled when client closes the connection) is
// passed down to the walker so we stop work ASAP on disconnect.
func (h *SearchHandler) Stream(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	userID := middleware.GetUserID(r)

	// Authorization: any logged-in user is fine, but the space must exist and
	// the user must be a member. This mirrors git_handler.checkSpaceAccess.
	space, err := h.spaceService.GetBySlug(slug)
	if err != nil {
		http.Error(w, "Space not found", http.StatusNotFound)
		return
	}
	if !h.spaceService.IsSpaceMember(space.ID, userID) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	spacePath, ok := h.spaceService.SpacePath(slug)
	if !ok {
		http.Error(w, "Space path not resolvable", http.StatusNotFound)
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "q parameter required", http.StatusBadRequest)
		return
	}
	subtree := r.URL.Query().Get("subtree")
	mode := service.SearchMode(r.URL.Query().Get("mode"))
	if mode != service.SearchModeTitle && mode != service.SearchModeTitleBody {
		mode = service.SearchModeTitle
	}

	// Headers for streaming. http.Flusher support is required; if absent we
	// can't stream, so signal server error rather than buffer everything.
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // nginx: don't buffer
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	flusher.Flush()

	encoder := json.NewEncoder(w)
	emitErr := make(chan error, 1)

	go func() {
		emitErr <- h.searchService.StreamSearch(r.Context(), spacePath, subtree, q, mode, func(hit service.SearchHit) error {
			if err := encoder.Encode(hit); err != nil {
				return err
			}
			// encoder.Encode writes a trailing newline, perfect for NDJSON.
			flusher.Flush()
			return nil
		})
	}()

	// Wait for the walker. If the client disconnects, r.Context() cancels and
	// the walker stops on its next ctx.Done() check.
	err = <-emitErr
	if err != nil && err != r.Context().Err() {
		// Best-effort error line at the end. Client may have already moved on.
		_ = encoder.Encode(map[string]string{"error": err.Error()})
		flusher.Flush()
	}
}
