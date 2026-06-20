package model

type UserPreferences struct {
	LastActiveSpaceSlug *string                     `json:"last_active_space_slug"`
	SpacePreferences    map[string]*SpacePreference `json:"space_preferences"`
	// HasUnsplashKey 只返回布尔，不暴露 key 本身（安全）
	HasUnsplashKey bool `json:"has_unsplash_key"`
}

type SpacePreference struct {
	LastViewedPageID *string   `json:"last_viewed_page_id"`
	ExpandedPageIDs  []string  `json:"expanded_page_ids"`
}

type UpdatePreferencesRequest struct {
	LastActiveSpaceSlug *string   `json:"last_active_space_slug"`
	SpaceSlug           *string   `json:"space_slug"`
	LastViewedPageID    *string   `json:"last_viewed_page_id"`
	ExpandedPageIDs     *[]string `json:"expanded_page_ids"`
	// UnsplashAPIKey: 非空时写入，空字符串/null 时不动（不会清空已有 key）
	UnsplashAPIKey *string `json:"unsplash_api_key"`
}
