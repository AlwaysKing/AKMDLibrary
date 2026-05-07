package model

import "time"

type Page struct {
	ID        int       `json:"id" db:"id"`
	SpaceID   int       `json:"space_id" db:"-"` // filled from context, not stored in space DB
	Title     string    `json:"title" db:"title"`
	FilePath  string    `json:"file_path" db:"file_path"`
	Icon      string    `json:"icon" db:"icon"`
	CoverURL  string    `json:"cover_url" db:"cover_url"`
	FullPage  bool      `json:"full_page" db:"full_page"`
	SortOrder float64   `json:"sort_order" db:"sort_order"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	Content   string    `json:"content,omitempty"`
	Children  []*Page   `json:"children,omitempty"`
}

type PageNode struct {
	ID        int         `json:"id"`
	Title     string      `json:"title"`
	Icon      string      `json:"icon"`
	SortOrder float64     `json:"sort_order"`
	FilePath  string      `json:"-"` // Internal: used for DB enrichment, not exposed in JSON
	Children  []*PageNode `json:"children,omitempty"`
}

type CreatePageRequest struct {
	Title     string `json:"title"`
	ParentID  *int   `json:"parent_id,omitempty"`
	Icon      string `json:"icon"`
}

type UpdatePageRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

type UpdatePageMetaRequest struct {
	Title     *string  `json:"title"`
	Icon      *string  `json:"icon"`
	CoverURL  *string  `json:"cover_url"`
	FullPage  *bool    `json:"full_page"`
	SortOrder *float64 `json:"sort_order"`
}
