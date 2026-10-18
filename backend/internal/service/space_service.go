package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/pkg/filesystem"
)

type SpaceService struct {
	spaceRepo   *repository.SpaceRepository
	memberRepo  *repository.MemberRepository
	pageService *PageService
	docsDir     string

	// gitSync is optional; when set, space create/rename/delete notify the
	// auto-commit worker.
	gitSync *GitSyncWorker
}

// SetGitSyncWorker wires the auto-commit worker. Optional; call once at startup.
func (s *SpaceService) SetGitSyncWorker(w *GitSyncWorker) {
	s.gitSync = w
}

func (s *SpaceService) markGitDirty(spaceSlug string) {
	if s.gitSync == nil || spaceSlug == "" {
		return
	}
	s.gitSync.MarkDirty(spaceSlug)
}

func NewSpaceService(
	spaceRepo *repository.SpaceRepository,
	memberRepo *repository.MemberRepository,
	pageService *PageService,
	docsDir string,
) *SpaceService {
	return &SpaceService{
		spaceRepo:   spaceRepo,
		memberRepo:  memberRepo,
		pageService: pageService,
		docsDir:     docsDir,
	}
}

func (s *SpaceService) List(isAdmin bool, userID int) ([]*model.Space, error) {
	// Sync spaces from filesystem first
	if err := s.SyncFromFS(); err != nil {
		return nil, fmt.Errorf("failed to sync spaces: %w", err)
	}

	var spaces []*model.Space
	var err error
	if isAdmin {
		spaces, err = s.spaceRepo.ListByUserID(0)
	} else {
		spaces, err = s.spaceRepo.ListByUserID(userID)
	}
	if err != nil {
		return nil, err
	}

	visible := make([]*model.Space, 0, len(spaces))
	for _, space := range spaces {
		if !model.IsPersonalSpaceSlug(space.Slug) {
			visible = append(visible, space)
		}
	}
	return visible, nil
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

	spacePath := filepath.Join(s.docsDir, req.Name)
	if _, err := os.Lstat(spacePath); err == nil {
		return nil, errors.New("space directory already exists")
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to check space directory: %w", err)
	}

	sourcePath := strings.TrimSpace(req.SourcePath)
	importMode := strings.TrimSpace(req.ImportMode)
	if sourcePath != "" {
		resolvedSource, err := filepath.EvalSymlinks(sourcePath)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve source folder: %w", err)
		}
		if err := validateSpaceImportPaths(resolvedSource, spacePath, s.docsDir); err != nil {
			return nil, err
		}
		sourcePath = resolvedSource
	}

	switch {
	case importMode == "link":
		if sourcePath == "" {
			return nil, errors.New("source folder is required for reference mode")
		}
		if err := os.Symlink(sourcePath, spacePath); err != nil {
			return nil, fmt.Errorf("failed to create space symlink: %w", err)
		}
	case importMode == "copy":
		if sourcePath == "" {
			return nil, errors.New("source folder is required for copy mode")
		}
		if err := os.MkdirAll(spacePath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create space directory: %w", err)
		}
		if err := copyDirectoryContents(sourcePath, spacePath); err != nil {
			_ = os.RemoveAll(spacePath)
			return nil, fmt.Errorf("failed to copy source folder: %w", err)
		}
	case sourcePath != "" || importMode != "":
		return nil, errors.New("source_path and import_mode must be provided together")
	default:
		if err := os.MkdirAll(spacePath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create space directory: %w", err)
		}
		if err := os.WriteFile(filepath.Join(spacePath, "README.md"), []byte("# "+req.Name), 0644); err != nil {
			_ = os.RemoveAll(spacePath)
			return nil, fmt.Errorf("failed to create README: %w", err)
		}
	}

	space, err := s.spaceRepo.Create(req, slug)
	if err != nil {
		_ = os.RemoveAll(spacePath)
		return nil, fmt.Errorf("failed to create space: %w", err)
	}

	// Add creator as admin
	_, err = s.memberRepo.Add(space.ID, creatorID, "admin")
	if err != nil {
		_ = s.spaceRepo.Delete(space.ID)
		_ = os.RemoveAll(spacePath)
		return nil, fmt.Errorf("failed to add creator as admin: %w", err)
	}

	// If this directory happens to already be a git repo (e.g. user pre-init'd
	// it on the server), notify the worker so the README gets committed.
	s.markGitDirty(slug)

	return space, nil
}

func validateSpaceImportPaths(sourcePath, spacePath, docsDir string) error {
	sourceAbs, err := filepath.Abs(sourcePath)
	if err != nil {
		return err
	}
	spaceAbs, err := filepath.Abs(spacePath)
	if err != nil {
		return err
	}
	docsAbs, err := filepath.Abs(docsDir)
	if err != nil {
		return err
	}
	sourceAbs = filepath.Clean(sourceAbs)
	spaceAbs = filepath.Clean(spaceAbs)
	docsAbs = filepath.Clean(docsAbs)

	if pathWithin(spaceAbs, sourceAbs) {
		return errors.New("space directory cannot be inside the source folder")
	}
	if sourceAbs == docsAbs {
		return errors.New("source folder cannot be the docs root")
	}
	return nil
}

func pathWithin(path, parent string) bool {
	rel, err := filepath.Rel(parent, path)
	if err != nil {
		return false
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func copyDirectoryContents(source, destination string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyPath(filepath.Join(source, entry.Name()), filepath.Join(destination, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyPath(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}

	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(target, destination)
	case info.IsDir():
		if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
			return err
		}
		return copyDirectoryContents(source, destination)
	case info.Mode().IsRegular():
		return copyRegularFile(source, destination, info.Mode().Perm())
	default:
		return fmt.Errorf("unsupported file type: %s", source)
	}
}

func copyRegularFile(source, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func (s *SpaceService) Update(slug string, req *model.UpdateSpaceRequest) (*model.Space, error) {
	space, err := s.spaceRepo.GetBySlug(slug)
	if err != nil {
		return nil, err
	}

	var newSlugAfterRename string
	// If name is changed, update directory
	if req.Name != nil && *req.Name != space.Name {
		oldPath := filepath.Join(s.docsDir, space.Name)
		newPath := filepath.Join(s.docsDir, *req.Name)

		if err := os.Rename(oldPath, newPath); err != nil {
			return nil, fmt.Errorf("failed to rename directory: %w", err)
		}

		newSlugAfterRename = s.generateSlug(*req.Name)
		req.Slug = &newSlugAfterRename
	}

	updated, err := s.spaceRepo.Update(space.ID, req)
	if err != nil {
		return nil, err
	}
	// Only notify after the DB update succeeds.
	if newSlugAfterRename != "" {
		s.markGitDirty(newSlugAfterRename)
	}
	return updated, nil
}

// UpdateFeatureFlags overwrites the feature_flags JSON for a space and returns
// the parsed object. PUT semantics: replace, not merge.
func (s *SpaceService) UpdateFeatureFlags(slug string, flags model.FeatureFlags) (model.FeatureFlags, error) {
	data, err := json.Marshal(flags)
	if err != nil {
		return model.FeatureFlags{}, fmt.Errorf("failed to marshal feature flags: %w", err)
	}
	if err := s.spaceRepo.UpdateFeatureFlags(slug, string(data)); err != nil {
		return model.FeatureFlags{}, err
	}
	return flags, nil
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

func (s *SpaceService) MemberRole(spaceID, userID int) (string, bool) {
	member, err := s.memberRepo.GetBySpaceAndUser(spaceID, userID)
	if err != nil || member == nil {
		return "", false
	}
	return member.Role, true
}

// SpacePath resolves a space slug to its absolute directory under docsDir.
// Used by services (search, git) that need to read the space's files directly
// rather than go through the page tree. Mirrors GitService.resolveSpacePath
// semantics: exact dir name first, slugified fallback scan.
func (s *SpaceService) SpacePath(slug string) (string, bool) {
	if personalDir, ok := filesystem.PersonalWorkspacePath(s.docsDir, slug); ok {
		if info, err := os.Stat(personalDir); err == nil && info.IsDir() {
			return personalDir, true
		}
	}

	exact := filepath.Join(s.docsDir, slug)
	if info, err := os.Stat(exact); err == nil && info.IsDir() {
		return exact, true
	}
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if slugify(e.Name()) == slug {
			return filepath.Join(s.docsDir, e.Name()), true
		}
	}
	return "", false
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
