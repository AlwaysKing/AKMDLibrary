package service

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/alwaysking/akmdlibrary/pkg/frontmatter"
)

// SearchMode controls what gets matched.
type SearchMode string

const (
	SearchModeTitle      SearchMode = "title" // filename only
	SearchModeTitleBody  SearchMode = "all"   // filename + body
)

// SearchHit is one streamed match. PageID is read from frontmatter so the
// frontend can navigate to /s/<slug>/<pageId>. Empty PageID means the file
// has no UUID assigned yet — frontend should still show the result but may
// not be able to jump directly.
type SearchHit struct {
	PageID    string `json:"page_id"`
	Path      string `json:"path"`      // repo-root relative, e.g. "subdir/file.md"
	Title     string `json:"title"`     // basename without .md
	MatchType string `json:"match_type"` // "filename" | "content"
}

// SearchService walks a space's docs directory looking for files that match a
// query. Streaming via the emit callback so the HTTP handler can flush each
// hit as soon as it's found — no buffering the full result set.
type SearchService struct {
	docsDir string
}

func NewSearchService(docsDir string) *SearchService {
	return &SearchService{docsDir: docsDir}
}

var (
	ErrSearchSpaceNotFound = errors.New("space not found")
	ErrSearchQueryRequired = errors.New("query required")
)

// StreamSearch walks the subtree under docsDir/<spaceSlug>/[subtree] calling
// emit for each match. Returns nil on natural completion or ctx.Err() if the
// client disconnected. emit is called sequentially — the handler does the
// flushing.
//
// subtree semantics:
//   - "" → whole space
//   - "<dir>" → that directory recursively (legacy)
//   - "<file>.md" → page-anchor: search the file itself + its children dir
//     (the directory with the same basename, where sub-pages live per the
//     page_service convention at line 470)
//
// subtree is user-supplied; we clean it with a leading "/" to force
// absolute-from-root semantics and reject "../" escapes.
func (s *SearchService) StreamSearch(
	ctx context.Context,
	spacePath, subtree, query string,
	mode SearchMode,
	emit func(SearchHit) error,
) error {
	q := strings.TrimSpace(query)
	if q == "" {
		return ErrSearchQueryRequired
	}
	if mode == "" {
		mode = SearchModeTitle
	}
	lowQuery := strings.ToLower(q)

	// filepath.WalkDir does NOT follow symlinks. If spacePath itself is a
	// symlink to a real directory (common in dev: userdata/docs/<slug> →
	// elsewhere), WalkDir would visit only the symlink entry and never
	// descend. Resolve symlinks up front so the walker sees a real dir.
	resolvedSpace, err := filepath.EvalSymlinks(spacePath)
	if err != nil {
		resolvedSpace = spacePath // best-effort fallback
	}

	// Collect search targets. A page anchor produces two targets: the .md
	// file itself + the children directory.
	type target struct {
		file string // single .md file ("" = skip)
		dir  string // directory to walk recursively ("" = skip)
	}
	var targets []target

	if subtree == "" {
		targets = append(targets, target{dir: resolvedSpace})
	} else {
		cleaned := filepath.Clean("/" + subtree)
		cleaned = strings.TrimPrefix(cleaned, "/")
		if strings.HasSuffix(cleaned, ".md") {
			anchorFile := filepath.Join(resolvedSpace, cleaned)
			childrenDir := filepath.Join(resolvedSpace, strings.TrimSuffix(cleaned, ".md"))
			targets = append(targets, target{file: anchorFile, dir: childrenDir})
		} else {
			targets = append(targets, target{dir: filepath.Join(resolvedSpace, cleaned)})
		}
	}

	for _, t := range targets {
		if t.file != "" {
			if err := s.searchSingleFile(ctx, resolvedSpace, t.file, lowQuery, mode, emit); err != nil {
				return err
			}
		}
		if t.dir != "" {
			info, err := os.Stat(t.dir)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return fmt.Errorf("stat search root: %w", err)
			}
			if !info.IsDir() {
				continue
			}
			if err := s.walkDir(ctx, resolvedSpace, t.dir, lowQuery, mode, emit); err != nil {
				return err
			}
		}
	}
	return nil
}

// searchSingleFile inspects one .md file (non-recursive). Skips silently
// if missing or not a file.
func (s *SearchService) searchSingleFile(
	ctx context.Context, spacePath, path, lowQuery string,
	mode SearchMode, emit func(SearchHit) error,
) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return nil
	}
	return matchFile(spacePath, path, lowQuery, mode, emit)
}

// walkDir walks root recursively, invoking matchFile on each .md. Walker is
// ctx-aware via fs.SkipAll.
func (s *SearchService) walkDir(
	ctx context.Context, spacePath, root, lowQuery string,
	mode SearchMode, emit func(SearchHit) error,
) error {
	var cancelled atomic.Bool
	walkErr := filepath.WalkDir(root, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			cancelled.Store(true)
			return fs.SkipAll
		default:
		}

		if d.IsDir() {
			name := d.Name()
			// Skip dot-dirs and known non-page dirs. _assets holds images;
			// .git obviously; anything starting with . is config.
			if name == ".git" || name == "_assets" || strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		return matchFile(spacePath, p, lowQuery, mode, emit)
	})
	if walkErr != nil {
		return walkErr
	}
	if cancelled.Load() {
		return ctx.Err()
	}
	return nil
}

// matchFile checks a single .md file against the query and emits a hit on
// match. Filename match is highest priority and skips body. Body is only
// scanned when mode = all.
func matchFile(spacePath, path, lowQuery string, mode SearchMode, emit func(SearchHit) error) error {
	name := filepath.Base(path)
	title := strings.TrimSuffix(name, ".md")
	rel, relErr := filepath.Rel(spacePath, path)
	if relErr != nil {
		return nil
	}
	relForward := filepath.ToSlash(rel)

	if strings.Contains(strings.ToLower(title), lowQuery) {
		hit := SearchHit{
			PageID:    readPageID(path),
			Path:      relForward,
			Title:     title,
			MatchType: "filename",
		}
		return emit(hit)
	}

	if mode != SearchModeTitleBody {
		return nil
	}
	if _, found := scanBodyForMatch(path, lowQuery); found {
		hit := SearchHit{
			PageID:    readPageID(path),
			Path:      relForward,
			Title:     title,
			MatchType: "content",
		}
		return emit(hit)
	}
	return nil
}

// scanBodyForMatch streams the file line by line, returning true on first
// match. We don't collect snippets because the user wants title-only display
// in the UI; the body match just flags inclusion.
func scanBodyForMatch(path, lowQuery string) (string, bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// Default buffer is 64KB; bump to 1MB so very long lines don't fail.
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if strings.Contains(strings.ToLower(scanner.Text()), lowQuery) {
			return scanner.Text(), true
		}
	}
	return "", false
}

// readPageID opens the file, parses frontmatter, returns the id field.
// Returns "" on any error or missing field — the search still emits the hit,
// just without a navigation target.
func readPageID(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	fm, _, err := frontmatter.Parse(raw)
	if err != nil {
		return ""
	}
	return fm.ID
}
