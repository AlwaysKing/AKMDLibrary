package model

import "time"

type DatabaseColumn struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Icon        string         `json:"icon,omitempty"`
	Readonly    bool           `json:"readonly"`
	Auto        bool           `json:"auto"`
	Default     any            `json:"default,omitempty"`
	Description string         `json:"description,omitempty"`
	Config      map[string]any `json:"config,omitempty"`
}

type DatabaseConfig struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Icon        string           `json:"icon,omitempty"`
	Description string           `json:"description,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
	Columns     []DatabaseColumn `json:"columns"`
}

type DatabaseSummary struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	DirName     string    `json:"dir_name"`
	Icon        string    `json:"icon,omitempty"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ColumnCount int       `json:"column_count"`
	RowCount    int       `json:"row_count"`
}

type DatabaseDetail struct {
	DatabaseSummary
	Columns []DatabaseColumn `json:"columns"`
}

type DatabaseRow struct {
	UUID   string            `json:"uuid"`
	Values map[string]string `json:"values"`
}

type DatabaseRowsResponse struct {
	Rows   []DatabaseRow `json:"rows"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

type CreateDatabaseRequest struct {
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

type UpdateDatabaseRequest struct {
	Name        *string `json:"name"`
	Icon        *string `json:"icon"`
	Description *string `json:"description"`
}

type CreateDatabaseColumnRequest struct {
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Icon        string         `json:"icon"`
	Default     any            `json:"default"`
	Description string         `json:"description"`
	Config      map[string]any `json:"config"`
}

type UpdateDatabaseColumnRequest struct {
	Name        *string         `json:"name"`
	Type        *string         `json:"type"`
	Icon        *string         `json:"icon"`
	Default     *any            `json:"default"`
	Description *string         `json:"description"`
	Config      *map[string]any `json:"config"`
}

type ReorderDatabaseColumnsRequest struct {
	ColumnIDs []string `json:"column_ids"`
}

type ReorderDatabaseRowsRequest struct {
	RowIDs []string `json:"row_ids"`
}

type CreateDatabaseRowRequest struct {
	Values map[string]string `json:"values"`
}

type UpdateDatabaseRowRequest struct {
	Values map[string]string `json:"values"`
}

type DatabaseRowPage struct {
	Markdown string `json:"markdown"`
	Title    string `json:"title"`
}

type UpdateDatabaseRowPageRequest struct {
	Markdown string `json:"markdown"`
}
