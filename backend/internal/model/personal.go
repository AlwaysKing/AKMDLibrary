package model

import "strings"

const PersonalSpacePrefix = ".personal-"

func IsPersonalSpaceSlug(slug string) bool {
	return strings.HasPrefix(slug, PersonalSpacePrefix)
}

type PersonalTodo struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
	Done  bool   `json:"done"`
}

type PersonalOverview struct {
	SpaceSlug string         `json:"space_slug"`
	Todos     []PersonalTodo `json:"todos"`
	Notes     []*PageNode    `json:"notes"`
}

type CreatePersonalTodoRequest struct {
	Text string `json:"text"`
}

type UpdatePersonalTodoRequest struct {
	Text *string `json:"text"`
	Done *bool   `json:"done"`
}

type CreatePersonalNoteRequest struct {
	Title    string  `json:"title"`
	ParentID *string `json:"parent_id,omitempty"`
}
