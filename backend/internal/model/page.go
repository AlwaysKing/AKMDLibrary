package model

import "time"

type Page struct {
	ID        string    `json:"id" db:"id"`
	SpaceID   int       `json:"space_id" db:"-"` // filled from context, not stored in space DB
	Title     string    `json:"title" db:"title"`
	FilePath  string    `json:"file_path" db:"file_path"`
	Icon      string    `json:"icon" db:"icon"`
	CoverURL  string    `json:"cover_url" db:"cover_url"`
	FullPage    bool      `json:"full_page" db:"full_page"`
	IsLocked    bool      `json:"is_locked" db:"is_locked"`
	IconLarge   bool      `json:"icon_large" db:"-"`
	CoverOffset int       `json:"cover_offset" db:"-"`
	SortOrder   float64   `json:"sort_order" db:"sort_order"`
	IsStarred     bool       `json:"is_starred" db:"is_starred"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty" db:"last_accessed_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	Content   string    `json:"content,omitempty"`
	Children  []*Page   `json:"children,omitempty"`
}

type PageNode struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"`
	Icon      string      `json:"icon"`
	SortOrder float64     `json:"sort_order"`
	FilePath  string      `json:"file_path"`
	Children  []*PageNode `json:"children,omitempty"`
}

type CreatePageRequest struct {
	Title     string `json:"title"`
	ParentID  *string `json:"parent_id,omitempty"`
	Icon      string `json:"icon"`
}

type UpdatePageRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

type UpdatePageMetaRequest struct {
	Title       *string  `json:"title"`
	Icon        *string  `json:"icon"`
	CoverURL    *string  `json:"cover_url"`
	FullPage    *bool    `json:"full_page"`
	IsLocked    *bool    `json:"is_locked"`
	IconLarge   *bool    `json:"icon_large"`
	CoverOffset *int     `json:"cover_offset"`
	SortOrder   *float64 `json:"sort_order"`
	IsStarred   *bool    `json:"is_starred"`
}
