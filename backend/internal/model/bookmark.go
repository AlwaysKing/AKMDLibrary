package model

import "time"

type BookmarkMeta struct {
	URL         string    `json:"url" db:"url"`
	Title       string    `json:"title" db:"title"`
	Description string    `json:"description" db:"description"`
	FaviconURL  string    `json:"favicon_url" db:"favicon_url"`
	ImageURL    string    `json:"image_url" db:"image_url"`
	FetchedAt   time.Time `json:"fetched_at" db:"fetched_at"`
	ExpiresAt   time.Time `json:"expires_at" db:"expires_at"`
}
