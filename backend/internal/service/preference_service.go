package service

import (
	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/repository"
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

	return nil
}
