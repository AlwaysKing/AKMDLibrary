package model

import (
	"encoding/json"
	"time"
)

type Space struct {
	ID           int             `json:"id" db:"id"`
	Name         string          `json:"name" db:"name"`
	Slug         string          `json:"slug" db:"slug"`
	Icon         string          `json:"icon" db:"icon"`
	Description  string          `json:"description" db:"description"`
	FeatureFlags json.RawMessage `json:"feature_flags" db:"feature_flags"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at" db:"updated_at"`
}

// FeatureFlags is the parsed shape of Space.FeatureFlags. Add new toggles
// here as fields; absent fields decode to their zero value (off).
type FeatureFlags struct {
	Git    bool `json:"git"`
	Claude bool `json:"claude"`
}

// ParseFeatureFlags decodes the JSON column into a FeatureFlags struct.
// Empty or invalid JSON yields the zero value (all features off).
func (s *Space) ParseFeatureFlags() FeatureFlags {
	var f FeatureFlags
	if len(s.FeatureFlags) == 0 {
		return f
	}
	if err := json.Unmarshal(s.FeatureFlags, &f); err != nil {
		return FeatureFlags{}
	}
	return f
}

type CreateSpaceRequest struct {
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

type UpdateSpaceRequest struct {
	Name        *string `json:"name"`
	Slug        *string `json:"slug"`
	Icon        *string `json:"icon"`
	Description *string `json:"description"`
}
