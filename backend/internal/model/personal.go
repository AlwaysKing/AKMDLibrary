package model

import "strings"

const PersonalSpacePrefix = ".personal-"

func IsPersonalSpaceSlug(slug string) bool {
	return strings.HasPrefix(slug, PersonalSpacePrefix)
}

type PersonalTodo struct {
	ID          string            `json:"id"`
	Text        string            `json:"text"`
	Done        bool              `json:"done"`
	CreatedAt   string            `json:"created_at"`
	TodayOn     string            `json:"today_on,omitempty"`
	TodaySetAt  string            `json:"today_set_at,omitempty"`
	CompletedAt string            `json:"completed_at,omitempty"`
	IsToday     bool              `json:"is_today"`
	Overdue     bool              `json:"overdue"`
	Link        *PersonalTodoLink `json:"link,omitempty"`
}

type PersonalTodoLink struct {
	Type       string `json:"type"`
	SpaceSlug  string `json:"space_slug"`
	PageID     string `json:"page_id,omitempty"`
	DatabaseID string `json:"database_id,omitempty"`
	RowID      string `json:"row_id,omitempty"`
}

type PersonalOverview struct {
	SpaceSlug string         `json:"space_slug"`
	Todos     []PersonalTodo `json:"todos"`
	Notes     []*PageNode    `json:"notes"`
	Recent    []*PageNode    `json:"recent"`
}

type CreatePersonalTodoRequest struct {
	Text  string            `json:"text"`
	Today bool              `json:"today"`
	Link  *PersonalTodoLink `json:"link,omitempty"`
}

type UpdatePersonalTodoRequest struct {
	Text  *string `json:"text"`
	Done  *bool   `json:"done"`
	Today *bool   `json:"today"`
}

type CreatePersonalTodoResponse struct {
	Todo    PersonalTodo   `json:"todo"`
	Todos   []PersonalTodo `json:"todos"`
	Created bool           `json:"created"`
}

type CreatePersonalNoteRequest struct {
	Title    string  `json:"title"`
	ParentID *string `json:"parent_id,omitempty"`
}
