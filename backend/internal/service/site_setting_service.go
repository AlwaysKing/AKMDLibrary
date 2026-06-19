package service

import (
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
)

type SiteSettingService struct {
	repo *repository.SiteSettingRepository
}

func NewSiteSettingService(repo *repository.SiteSettingRepository) *SiteSettingService {
	return &SiteSettingService{repo: repo}
}

func (s *SiteSettingService) Get() (*model.SiteSettings, error) {
	favicon, err := s.repo.Get("favicon")
	if err != nil {
		return nil, err
	}
	logo, err := s.repo.Get("logo")
	if err != nil {
		return nil, err
	}
	siteName, err := s.repo.Get("site_name")
	if err != nil {
		return nil, err
	}

	settings := &model.SiteSettings{}
	if favicon != "" {
		settings.Favicon = &favicon
	}
	if logo != "" {
		settings.Logo = &logo
	}
	if siteName != "" {
		settings.SiteName = &siteName
	}

	return settings, nil
}

func (s *SiteSettingService) Update(req *model.UpdateSiteSettingsRequest) error {
	if req.Favicon != nil {
		if err := s.repo.Set("favicon", *req.Favicon); err != nil {
			return err
		}
	}
	if req.Logo != nil {
		if err := s.repo.Set("logo", *req.Logo); err != nil {
			return err
		}
	}
	if req.SiteName != nil {
		if err := s.repo.Set("site_name", *req.SiteName); err != nil {
			return err
		}
	}
	return nil
}
