package model

type UserPreferences struct {
	LastActiveSpaceSlug *string                     `json:"last_active_space_slug"`
	SidebarWidth        *int                        `json:"sidebar_width"`
	SidebarCollapsed    *bool                       `json:"sidebar_collapsed"`
	CodeTheme           *string                     `json:"code_theme"`
	SpacePreferences    map[string]*SpacePreference `json:"space_preferences"`
	// HasUnsplashKey 只返回布尔，不暴露 key 本身（安全）
	HasUnsplashKey bool `json:"has_unsplash_key"`
}

type SpacePreference struct {
	LastViewedPageID *string            `json:"last_viewed_page_id"`
	ExpandedPageIDs  []string           `json:"expanded_page_ids"`
	// CollapsedSections: 侧边栏区块（最近/最爱/文档）折叠状态
	CollapsedSections map[string]bool `json:"collapsed_sections"`
	// QuickAccessExpandedIDs: "最近/最爱"区页面展开状态（与文档树 expanded_page_ids 相互独立）
	QuickAccessExpandedIDs []string `json:"quick_access_expanded_ids"`
}

type UpdatePreferencesRequest struct {
	LastActiveSpaceSlug *string   `json:"last_active_space_slug"`
	SidebarWidth        *int      `json:"sidebar_width"`
	SidebarCollapsed    *bool     `json:"sidebar_collapsed"`
	CodeTheme           *string   `json:"code_theme"`
	SpaceSlug           *string   `json:"space_slug"`
	LastViewedPageID    *string   `json:"last_viewed_page_id"`
	ExpandedPageIDs     *[]string `json:"expanded_page_ids"`
	// CollapsedSections / QuickAccessExpandedIDs: 空间级侧边栏 UI 状态
	CollapsedSections      *map[string]bool `json:"collapsed_sections"`
	QuickAccessExpandedIDs *[]string        `json:"quick_access_expanded_ids"`
	// UnsplashAPIKey: 非空时写入，空字符串/null 时不动（不会清空已有 key）
	UnsplashAPIKey *string `json:"unsplash_api_key"`
}
