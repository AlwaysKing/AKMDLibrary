package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/alwaysking/akmdlibrary/internal/model"
)

type PreferenceRepository struct {
	db *DB
}

func NewPreferenceRepository(db *DB) *PreferenceRepository {
	return &PreferenceRepository{db: db}
}

func (r *PreferenceRepository) GetByUserID(userID int) (*model.UserPreferences, error) {
	prefs := &model.UserPreferences{
		SpacePreferences: make(map[string]*model.SpacePreference),
	}

	// Get global preferences
	var lastSpace sql.NullString
	var unsplashKey sql.NullString
	err := r.db.QueryRow(
		"SELECT last_active_space_slug, unsplash_api_key FROM user_global_preferences WHERE user_id = ?",
		userID,
	).Scan(&lastSpace, &unsplashKey)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to get global preferences: %w", err)
	}
	if lastSpace.Valid {
		prefs.LastActiveSpaceSlug = &lastSpace.String
	}
	prefs.HasUnsplashKey = unsplashKey.Valid && unsplashKey.String != ""

	// Get space preferences
	rows, err := r.db.Query(
		"SELECT space_slug, last_viewed_page_id, expanded_page_ids FROM user_space_preferences WHERE user_id = ?",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get space preferences: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var slug string
		var pageID sql.NullString
		var expandedJSON string
		if err := rows.Scan(&slug, &pageID, &expandedJSON); err != nil {
			return nil, fmt.Errorf("failed to scan space preference: %w", err)
		}

		sp := &model.SpacePreference{}
		if pageID.Valid {
			sp.LastViewedPageID = &pageID.String
		}
		if err := json.Unmarshal([]byte(expandedJSON), &sp.ExpandedPageIDs); err != nil {
			sp.ExpandedPageIDs = []string{}
		}
		prefs.SpacePreferences[slug] = sp
	}

	return prefs, nil
}

func (r *PreferenceRepository) UpsertGlobalPref(userID int, lastActiveSpaceSlug string) error {
	_, err := r.db.Exec(`
		INSERT INTO user_global_preferences (user_id, last_active_space_slug, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			last_active_space_slug = excluded.last_active_space_slug,
			updated_at = CURRENT_TIMESTAMP
	`, userID, lastActiveSpaceSlug)
	if err != nil {
		return fmt.Errorf("failed to upsert global preference: %w", err)
	}
	return nil
}

// SetUnsplashKey 写入用户的 Unsplash API key。空字符串会清空已有 key。
func (r *PreferenceRepository) SetUnsplashKey(userID int, key string) error {
	_, err := r.db.Exec(`
		INSERT INTO user_global_preferences (user_id, unsplash_api_key, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			unsplash_api_key = excluded.unsplash_api_key,
			updated_at = CURRENT_TIMESTAMP
	`, userID, key)
	if err != nil {
		return fmt.Errorf("failed to set unsplash api key: %w", err)
	}
	return nil
}

// GetUnsplashKey 读取用户的 Unsplash API key，返回空串表示未配置。
func (r *PreferenceRepository) GetUnsplashKey(userID int) (string, error) {
	var key sql.NullString
	err := r.db.QueryRow(
		"SELECT unsplash_api_key FROM user_global_preferences WHERE user_id = ?",
		userID,
	).Scan(&key)
	if err != nil && err != sql.ErrNoRows {
		return "", fmt.Errorf("failed to get unsplash api key: %w", err)
	}
	if !key.Valid {
		return "", nil
	}
	return key.String, nil
}

func (r *PreferenceRepository) UpsertSpacePref(userID int, spaceSlug string, lastViewedPageID *string, expandedPageIDs *[]string) error {
	var pageID interface{}
	if lastViewedPageID != nil {
		pageID = *lastViewedPageID
	}

	// Build JSON for INSERT value: use provided ids or default empty array
	idsJSON := "[]"
	if expandedPageIDs != nil {
		b, err := json.Marshal(*expandedPageIDs)
		if err != nil {
			return fmt.Errorf("failed to marshal expanded page ids: %w", err)
		}
		idsJSON = string(b)
	}

	// For CASE WHEN check: nil means "not provided" → NULL in SQL → preserve old value
	var expandedCheck interface{}
	if expandedPageIDs != nil {
		expandedCheck = idsJSON
	}

	_, err := r.db.Exec(`
		INSERT INTO user_space_preferences (user_id, space_slug, last_viewed_page_id, expanded_page_ids, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id, space_slug) DO UPDATE SET
			last_viewed_page_id = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.last_viewed_page_id END,
			expanded_page_ids = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.expanded_page_ids END,
			updated_at = CURRENT_TIMESTAMP
	`, userID, spaceSlug, pageID, idsJSON, pageID, pageID, expandedCheck, idsJSON)
	if err != nil {
		return fmt.Errorf("failed to upsert space preference: %w", err)
	}
	return nil
}
