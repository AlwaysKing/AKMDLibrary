package repository

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/alwaysking/mdlibrary/internal/model"
)

type PageRepository struct {
	db *sql.DB
}

func NewPageRepository(db *sql.DB) *PageRepository {
	return &PageRepository{db: db}
}

const pageColumns = `id, title, file_path, icon, cover_url, full_page, sort_order, is_starred, last_accessed_at, created_at, updated_at`

func scanPage(scanner interface{ Scan(...interface{}) error }) (*model.Page, error) {
	var page model.Page
	var icon, coverURL sql.NullString
	var lastAccessed sql.NullTime
	err := scanner.Scan(
		&page.ID, &page.Title, &page.FilePath,
		&icon, &coverURL, &page.FullPage, &page.SortOrder,
		&page.IsStarred, &lastAccessed,
		&page.CreatedAt, &page.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if icon.Valid {
		page.Icon = icon.String
	}
	if coverURL.Valid {
		page.CoverURL = coverURL.String
	}
	if lastAccessed.Valid {
		page.LastAccessedAt = &lastAccessed.Time
	}
	return &page, nil
}

func (r *PageRepository) Create(page *model.Page) (*model.Page, error) {
	query := `
		INSERT INTO pages (id, title, file_path, icon, cover_url, sort_order)
		VALUES (?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.Exec(query, page.ID, page.Title, page.FilePath,
		page.Icon, page.CoverURL, page.SortOrder)
	if err != nil {
		return nil, fmt.Errorf("failed to create page: %w", err)
	}

	return r.GetByID(page.ID)
}

func (r *PageRepository) GetByID(id string) (*model.Page, error) {
	query := `SELECT ` + pageColumns + ` FROM pages WHERE id = ?`

	page, err := scanPage(r.db.QueryRow(query, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("page not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get page: %w", err)
	}
	return page, nil
}

func (r *PageRepository) GetByPath(filePath string) (*model.Page, error) {
	query := `SELECT ` + pageColumns + ` FROM pages WHERE file_path = ?`

	page, err := scanPage(r.db.QueryRow(query, filePath))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("page not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get page: %w", err)
	}
	return page, nil
}

func (r *PageRepository) ListAll() ([]*model.Page, error) {
	query := `SELECT ` + pageColumns + ` FROM pages ORDER BY sort_order ASC, created_at ASC`

	rows, err := r.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to list pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.Page
	for rows.Next() {
		page, err := scanPage(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan page: %w", err)
		}
		pages = append(pages, page)
	}

	return pages, nil
}

func (r *PageRepository) Update(id string, page *model.UpdatePageRequest) (*model.Page, error) {
	if page.Title != "" {
		query := `UPDATE pages SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
		if _, err := r.db.Exec(query, page.Title, id); err != nil {
			return nil, fmt.Errorf("failed to update page: %w", err)
		}
	} else {
		query := `UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
		if _, err := r.db.Exec(query, id); err != nil {
			return nil, fmt.Errorf("failed to update page: %w", err)
		}
	}

	return r.GetByID(id)
}

func (r *PageRepository) UpdateMeta(id string, req *model.UpdatePageMetaRequest) (*model.Page, error) {
	setParts := []string{}
	args := []interface{}{}

	if req.Title != nil {
		setParts = append(setParts, "title = ?")
		args = append(args, *req.Title)
	}
	if req.Icon != nil {
		setParts = append(setParts, "icon = ?")
		args = append(args, *req.Icon)
	}
	if req.CoverURL != nil {
		setParts = append(setParts, "cover_url = ?")
		args = append(args, *req.CoverURL)
	}
	if req.FullPage != nil {
		setParts = append(setParts, "full_page = ?")
		args = append(args, *req.FullPage)
	}
	if req.SortOrder != nil {
		setParts = append(setParts, "sort_order = ?")
		args = append(args, *req.SortOrder)
	}
	if req.IsStarred != nil {
		setParts = append(setParts, "is_starred = ?")
		args = append(args, *req.IsStarred)
	}
	setParts = append(setParts, "updated_at = CURRENT_TIMESTAMP")

	query := "UPDATE pages SET " + strings.Join(setParts, ", ") + " WHERE id = ?"
	args = append(args, id)

	if _, err := r.db.Exec(query, args...); err != nil {
		return nil, fmt.Errorf("failed to update page meta: %w", err)
	}

	return r.GetByID(id)
}

func (r *PageRepository) UpdateFilePath(id string, filePath string) error {
	query := "UPDATE pages SET file_path = ? WHERE id = ?"
	_, err := r.db.Exec(query, filePath, id)
	return err
}

func (r *PageRepository) Delete(id string) error {
	query := "DELETE FROM pages WHERE id = ?"

	result, err := r.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete page: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("page not found")
	}

	return nil
}

// MaxSortOrder returns the maximum sort_order value among all pages.
// Returns 0 if there are no pages.
func (r *PageRepository) MaxSortOrder() (float64, error) {
	var maxSort sql.NullFloat64
	err := r.db.QueryRow(`SELECT MAX(sort_order) FROM pages`).Scan(&maxSort)
	if err != nil {
		return 0, fmt.Errorf("failed to get max sort_order: %w", err)
	}
	if !maxSort.Valid {
		return 0, nil
	}
	return maxSort.Float64, nil
}

// TouchAccess updates last_accessed_at to now for a page (tracks recent access)
func (r *PageRepository) TouchAccess(id string) error {
	_, err := r.db.Exec("UPDATE pages SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?", id)
	return err
}

// ListStarred returns all starred pages
func (r *PageRepository) ListStarred() ([]*model.Page, error) {
	query := `SELECT ` + pageColumns + ` FROM pages WHERE is_starred = 1 ORDER BY title ASC`

	rows, err := r.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to list starred pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.Page
	for rows.Next() {
		page, err := scanPage(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan page: %w", err)
		}
		pages = append(pages, page)
	}
	return pages, nil
}

// GetSiblings returns all pages that are direct children of the given parent directory.
// parentRelDir is the relative directory path (e.g., "my-space" for root or "my-space/Parent/Child" for nested).
// It matches only "*.md" files directly in that directory (no nested subdirectories).
func (r *PageRepository) GetSiblings(parentRelDir string) ([]*model.Page, error) {
	pattern := parentRelDir + "/%.md"
	// Exclude nested paths: only entries with no extra "/" after the prefix
	query := `SELECT ` + pageColumns + ` FROM pages WHERE file_path LIKE ? ESCAPE '\' AND file_path NOT LIKE ? ESCAPE '\' ORDER BY sort_order ASC, created_at ASC`

	// We need: file_path LIKE 'dir/%.md' but NOT LIKE 'dir/%/%.md'
	// The first LIKE catches all .md files in subdirectories of parentRelDir.
	// To filter to only direct children, we exclude any path that has an additional slash.
	// Pattern: 'dir/%.md' and NOT 'dir/%/%'
	nestedPattern := parentRelDir + "/%/%"

	rows, err := r.db.Query(query, pattern, nestedPattern)
	if err != nil {
		return nil, fmt.Errorf("failed to get siblings: %w", err)
	}
	defer rows.Close()

	var pages []*model.Page
	for rows.Next() {
		page, err := scanPage(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan page: %w", err)
		}
		pages = append(pages, page)
	}
	return pages, nil
}

// SortOrderUpdate represents a batch sort_order update for a page.
type SortOrderUpdate struct {
	ID        string
	SortOrder float64
}

// UpdateSortOrders batch-updates sort_order for multiple pages in a single transaction.
func (r *PageRepository) UpdateSortOrders(updates []SortOrderUpdate) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	stmt, err := tx.Prepare("UPDATE pages SET sort_order = ? WHERE id = ?")
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, u := range updates {
		if _, err := stmt.Exec(u.SortOrder, u.ID); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to update sort_order: %w", err)
		}
	}

	return tx.Commit()
}

// UpdateFilePathPrefix updates all file_path values that start with oldPrefix to start with newPrefix.
// Used when moving a page (and its children) to a new directory without rebuilding the entire cache.
func (r *PageRepository) UpdateFilePathPrefix(oldPrefix string, newPrefix string) error {
	_, err := r.db.Exec(
		"UPDATE pages SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?",
		oldPrefix, newPrefix, oldPrefix+"%",
	)
	return err
}

// ListRecent returns pages ordered by last access time (most recent first)
func (r *PageRepository) ListRecent(limit int) ([]*model.Page, error) {
	query := `SELECT ` + pageColumns + ` FROM pages WHERE last_accessed_at IS NOT NULL ORDER BY last_accessed_at DESC LIMIT ?`

	rows, err := r.db.Query(query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list recent pages: %w", err)
	}
	defer rows.Close()

	var pages []*model.Page
	for rows.Next() {
		page, err := scanPage(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan page: %w", err)
		}
		pages = append(pages, page)
	}
	return pages, nil
}
