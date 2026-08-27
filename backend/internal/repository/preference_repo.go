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
	var sidebarWidth sql.NullInt64
	var sidebarCollapsed sql.NullBool
	var codeTheme sql.NullString
	var unsplashKey sql.NullString
	err := r.db.QueryRow(
		"SELECT last_active_space_slug, sidebar_width, sidebar_collapsed, code_theme, unsplash_api_key FROM user_global_preferences WHERE user_id = ?",
		userID,
	).Scan(&lastSpace, &sidebarWidth, &sidebarCollapsed, &codeTheme, &unsplashKey)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to get global preferences: %w", err)
	}
	if lastSpace.Valid {
		prefs.LastActiveSpaceSlug = &lastSpace.String
	}
	if sidebarWidth.Valid {
		width := int(sidebarWidth.Int64)
		prefs.SidebarWidth = &width
	}
	if sidebarCollapsed.Valid {
		collapsed := sidebarCollapsed.Bool
		prefs.SidebarCollapsed = &collapsed
	}
	if codeTheme.Valid {
		prefs.CodeTheme = &codeTheme.String
	}
	prefs.HasUnsplashKey = unsplashKey.Valid && unsplashKey.String != ""

	// Get space preferences
	rows, err := r.db.Query(
		"SELECT space_slug, last_viewed_page_id, expanded_page_ids, collapsed_sections, quick_access_expanded_ids FROM user_space_preferences WHERE user_id = ?",
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
		var collapsedSectionsJSON string
		var quickAccessJSON string
		if err := rows.Scan(&slug, &pageID, &expandedJSON, &collapsedSectionsJSON, &quickAccessJSON); err != nil {
			return nil, fmt.Errorf("failed to scan space preference: %w", err)
		}

		sp := &model.SpacePreference{}
		if pageID.Valid {
			sp.LastViewedPageID = &pageID.String
		}
		if err := json.Unmarshal([]byte(expandedJSON), &sp.ExpandedPageIDs); err != nil {
			sp.ExpandedPageIDs = []string{}
		}
		if err := json.Unmarshal([]byte(collapsedSectionsJSON), &sp.CollapsedSections); err != nil {
			sp.CollapsedSections = map[string]bool{}
		}
		if err := json.Unmarshal([]byte(quickAccessJSON), &sp.QuickAccessExpandedIDs); err != nil {
			sp.QuickAccessExpandedIDs = []string{}
		}
		prefs.SpacePreferences[slug] = sp
	}

	return prefs, nil
}

func (r *PreferenceRepository) UpsertGlobalPref(userID int, lastActiveSpaceSlug *string, sidebarWidth *int, sidebarCollapsed *bool, codeTheme *string) error {
	var sidebarValue interface{}
	if sidebarWidth != nil {
		sidebarValue = *sidebarWidth
	}
	var sidebarCollapsedValue interface{}
	if sidebarCollapsed != nil {
		sidebarCollapsedValue = *sidebarCollapsed
	}
	var codeThemeValue interface{}
	if codeTheme != nil {
		codeThemeValue = *codeTheme
	}

	_, err := r.db.Exec(`
		INSERT INTO user_global_preferences (user_id, last_active_space_slug, sidebar_width, sidebar_collapsed, code_theme, updated_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			last_active_space_slug = CASE WHEN ? IS NOT NULL THEN ? ELSE user_global_preferences.last_active_space_slug END,
			sidebar_width = CASE WHEN ? IS NOT NULL THEN ? ELSE user_global_preferences.sidebar_width END,
			sidebar_collapsed = CASE WHEN ? IS NOT NULL THEN ? ELSE user_global_preferences.sidebar_collapsed END,
			code_theme = CASE WHEN ? IS NOT NULL THEN ? ELSE user_global_preferences.code_theme END,
			updated_at = CURRENT_TIMESTAMP
	`, userID, lastActiveSpaceSlug, sidebarValue, sidebarCollapsedValue, codeThemeValue,
		lastActiveSpaceSlug, lastActiveSpaceSlug,
		sidebarValue, sidebarValue,
		sidebarCollapsedValue, sidebarCollapsedValue,
		codeThemeValue, codeThemeValue)
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

func (r *PreferenceRepository) UpsertSpacePref(userID int, spaceSlug string, lastViewedPageID *string, expandedPageIDs *[]string, collapsedSections *map[string]bool, quickAccessExpandedIDs *[]string) error {
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

	sectionsJSON := "{}"
	if collapsedSections != nil {
		b, err := json.Marshal(*collapsedSections)
		if err != nil {
			return fmt.Errorf("failed to marshal collapsed sections: %w", err)
		}
		sectionsJSON = string(b)
	}
	var sectionsCheck interface{}
	if collapsedSections != nil {
		sectionsCheck = sectionsJSON
	}

	quickJSON := "[]"
	if quickAccessExpandedIDs != nil {
		b, err := json.Marshal(*quickAccessExpandedIDs)
		if err != nil {
			return fmt.Errorf("failed to marshal quick access expanded ids: %w", err)
		}
		quickJSON = string(b)
	}
	var quickCheck interface{}
	if quickAccessExpandedIDs != nil {
		quickCheck = quickJSON
	}

	_, err := r.db.Exec(`
		INSERT INTO user_space_preferences (user_id, space_slug, last_viewed_page_id, expanded_page_ids, collapsed_sections, quick_access_expanded_ids, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id, space_slug) DO UPDATE SET
			last_viewed_page_id = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.last_viewed_page_id END,
			expanded_page_ids = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.expanded_page_ids END,
			collapsed_sections = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.collapsed_sections END,
			quick_access_expanded_ids = CASE WHEN ? IS NOT NULL THEN ? ELSE user_space_preferences.quick_access_expanded_ids END,
			updated_at = CURRENT_TIMESTAMP
	`, userID, spaceSlug, pageID, idsJSON, sectionsJSON, quickJSON,
		pageID, pageID,
		expandedCheck, idsJSON,
		sectionsCheck, sectionsJSON,
		quickCheck, quickJSON)
	if err != nil {
		return fmt.Errorf("failed to upsert space preference: %w", err)
	}
	return nil
}
