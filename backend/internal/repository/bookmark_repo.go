package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/alwaysking/mdlibrary/internal/model"
)

type BookmarkRepository struct {
	db *sql.DB
}

func NewBookmarkRepository(db *sql.DB) *BookmarkRepository {
	return &BookmarkRepository{db: db}
}

func (r *BookmarkRepository) Get(url string) (*model.BookmarkMeta, error) {
	query := `SELECT url, title, description, favicon_url, image_url, fetched_at, expires_at
		FROM bookmark_meta WHERE url = ? AND expires_at > ?`

	row := r.db.QueryRow(query, url, time.Now().Format(time.RFC3339))
	meta := &model.BookmarkMeta{}
	err := row.Scan(&meta.URL, &meta.Title, &meta.Description, &meta.FaviconURL, &meta.ImageURL, &meta.FetchedAt, &meta.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get bookmark meta: %w", err)
	}
	return meta, nil
}

func (r *BookmarkRepository) Save(meta *model.BookmarkMeta) error {
	query := `INSERT INTO bookmark_meta (url, title, description, favicon_url, image_url, fetched_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(url) DO UPDATE SET
			title = excluded.title,
			description = excluded.description,
			favicon_url = excluded.favicon_url,
			image_url = excluded.image_url,
			fetched_at = excluded.fetched_at,
			expires_at = excluded.expires_at`

	_, err := r.db.Exec(query,
		meta.URL, meta.Title, meta.Description, meta.FaviconURL, meta.ImageURL,
		meta.FetchedAt.Format(time.RFC3339), meta.ExpiresAt.Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("failed to save bookmark meta: %w", err)
	}
	return nil
}
