package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/pkg/filesystem"
)

type SpaceService struct {
	spaceRepo  *repository.SpaceRepository
	memberRepo *repository.MemberRepository
	pageService *PageService
	docsDir    string
}

func NewSpaceService(
	spaceRepo *repository.SpaceRepository,
	memberRepo *repository.MemberRepository,
	pageService *PageService,
	docsDir string,
) *SpaceService {
	return &SpaceService{
		spaceRepo:  spaceRepo,
		memberRepo: memberRepo,
		pageService: pageService,
		docsDir:    docsDir,
	}
}

func (s *SpaceService) List(isAdmin bool, userID int) ([]*model.Space, error) {
	// Sync spaces from filesystem first
	if err := s.SyncFromFS(); err != nil {
		return nil, fmt.Errorf("failed to sync spaces: %w", err)
	}

	// Admin sees all spaces, regular users see only their spaces
	if isAdmin {
		return s.spaceRepo.ListByUserID(0)
	}
	spaces, err := s.spaceRepo.ListByUserID(userID)
	if err != nil {
		return nil, err
	}
	// If user has no memberships yet, return all spaces so they can see something
	if len(spaces) == 0 {
		return s.spaceRepo.ListByUserID(0)
	}
	return spaces, nil
}

func (s *SpaceService) GetBySlug(slug string) (*model.Space, error) {
	return s.spaceRepo.GetBySlug(slug)
}

func (s *SpaceService) Create(req *model.CreateSpaceRequest, creatorID int) (*model.Space, error) {
	slug := s.generateSlug(req.Name)

	// Check if slug already exists
	if _, err := s.spaceRepo.GetBySlug(slug); err == nil {
		return nil, errors.New("space with this name already exists")
	}

	// Create directory
	spacePath := filepath.Join(s.docsDir, req.Name)
	if err := os.MkdirAll(spacePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create space directory: %w", err)
	}

	// Create README.md
	readmePath := filepath.Join(spacePath, "README.md")
	if err := os.WriteFile(readmePath, []byte("# "+req.Name), 0644); err != nil {
		return nil, fmt.Errorf("failed to create README: %w", err)
	}

	space, err := s.spaceRepo.Create(req, slug)
	if err != nil {
		// Rollback directory creation
		os.RemoveAll(spacePath)
		return nil, fmt.Errorf("failed to create space: %w", err)
	}

	// Add creator as admin
	_, err = s.memberRepo.Add(space.ID, creatorID, "admin")
	if err != nil {
		return nil, fmt.Errorf("failed to add creator as admin: %w", err)
	}

	return space, nil
}

func (s *SpaceService) Update(slug string, req *model.UpdateSpaceRequest) (*model.Space, error) {
	space, err := s.spaceRepo.GetBySlug(slug)
	if err != nil {
		return nil, err
	}

	// If name is changed, update directory
	if req.Name != nil && *req.Name != space.Name {
		oldPath := filepath.Join(s.docsDir, space.Name)
		newPath := filepath.Join(s.docsDir, *req.Name)

		if err := os.Rename(oldPath, newPath); err != nil {
			return nil, fmt.Errorf("failed to rename directory: %w", err)
		}

		newSlug := s.generateSlug(*req.Name)
		req.Slug = &newSlug
	}

	return s.spaceRepo.Update(space.ID, req)
}

func (s *SpaceService) Delete(slug string) error {
	space, err := s.spaceRepo.GetBySlug(slug)
	if err != nil {
		return err
	}

	// Delete directory
	spacePath := filepath.Join(s.docsDir, space.Name)
	if err := os.RemoveAll(spacePath); err != nil {
		return fmt.Errorf("failed to delete space directory: %w", err)
	}

	return s.spaceRepo.Delete(space.ID)
}

func (s *SpaceService) ListMembers(spaceID int) ([]*model.SpaceMember, error) {
	return s.memberRepo.ListBySpaceID(spaceID)
}

func (s *SpaceService) AddMember(spaceID int, req *model.AddMemberRequest) (*model.SpaceMember, error) {
	// Check if user already exists
	if existing, err := s.memberRepo.GetBySpaceAndUser(spaceID, req.UserID); err == nil && existing != nil {
		return nil, errors.New("user is already a member of this space")
	}

	return s.memberRepo.Add(spaceID, req.UserID, req.Role)
}

func (s *SpaceService) UpdateMember(spaceID, memberID int, req *model.UpdateMemberRequest) (*model.SpaceMember, error) {
	// Verify member belongs to space
	member, err := s.memberRepo.GetByID(memberID)
	if err != nil {
		return nil, err
	}

	if member.SpaceID != spaceID {
		return nil, errors.New("member does not belong to this space")
	}

	return s.memberRepo.Update(memberID, req.Role)
}

func (s *SpaceService) RemoveMember(spaceID, memberID int) error {
	// Verify member belongs to space
	member, err := s.memberRepo.GetByID(memberID)
	if err != nil {
		return err
	}

	if member.SpaceID != spaceID {
		return errors.New("member does not belong to this space")
	}

	return s.memberRepo.Delete(memberID)
}

// IsSpaceMember checks if a user is a member of a space.
func (s *SpaceService) IsSpaceMember(spaceID, userID int) bool {
	member, err := s.memberRepo.GetBySpaceAndUser(spaceID, userID)
	return err == nil && member != nil
}

func (s *SpaceService) SyncFromFS() error {
	// Scan docs directory
	scanner := filesystem.NewScanner(s.docsDir)
	spaces, err := scanner.ScanSpaces()
	if err != nil {
		return err
	}

	// Sync to database
	return s.spaceRepo.SyncFromFS(spaces)
}

func (s *SpaceService) RefreshSpace(slug string) error {
	// Verify space exists
	_, err := s.GetBySlug(slug)
	if err != nil {
		return err
	}

	// Re-scan spaces from filesystem
	if err := s.SyncFromFS(); err != nil {
		return err
	}

	// Rebuild page cache for this space
	return s.pageService.RebuildCache(slug)
}

func (s *SpaceService) generateSlug(name string) string {
	return name
}
