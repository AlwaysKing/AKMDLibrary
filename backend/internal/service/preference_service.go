package service

import (
	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
)

type PreferenceService struct {
	prefRepo *repository.PreferenceRepository
}

func NewPreferenceService(prefRepo *repository.PreferenceRepository) *PreferenceService {
	return &PreferenceService{prefRepo: prefRepo}
}

func (s *PreferenceService) GetByUserID(userID int) (*model.UserPreferences, error) {
	return s.prefRepo.GetByUserID(userID)
}

func (s *PreferenceService) Update(userID int, req *model.UpdatePreferencesRequest) error {
	if req.LastActiveSpaceSlug != nil {
		if err := s.prefRepo.UpsertGlobalPref(userID, *req.LastActiveSpaceSlug); err != nil {
			return err
		}
	}

	if req.SpaceSlug != nil {
		if err := s.prefRepo.UpsertSpacePref(userID, *req.SpaceSlug, req.LastViewedPageID, req.ExpandedPageIDs); err != nil {
			return err
		}
	}

	// Unsplash key：非 nil 才更新（nil 表示前端没传这个字段，不动；空串会清空）
	if req.UnsplashAPIKey != nil {
		if err := s.prefRepo.SetUnsplashKey(userID, *req.UnsplashAPIKey); err != nil {
			return err
		}
	}

	return nil
}

// GetUnsplashKey 暴露给 Unsplash 代理 handler 使用
func (s *PreferenceService) GetUnsplashKey(userID int) (string, error) {
	return s.prefRepo.GetUnsplashKey(userID)
}
