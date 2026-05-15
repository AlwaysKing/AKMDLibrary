package model

type SiteSettings struct {
	Favicon  *string `json:"favicon"`
	Logo     *string `json:"logo"`
	SiteName *string `json:"site_name"`
}

type UpdateSiteSettingsRequest struct {
	Favicon  *string `json:"favicon"`
	Logo     *string `json:"logo"`
	SiteName *string `json:"site_name"`
}
