package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/repository"
	"github.com/alwaysking/mdlibrary/pkg/filesystem"
	"github.com/google/uuid"
)

type PageService struct {
	pageRepo *repository.PageRepository
	docsDir  string
}

func NewPageService(pageRepo *repository.PageRepository, docsDir string) *PageService {
	return &PageService{
		pageRepo: pageRepo,
		docsDir:  docsDir,
	}
}

func (s *PageService) GetTree(spaceSlug string) ([]*model.PageNode, error) {
	scanner := filesystem.NewScanner(s.docsDir)
	return scanner.ScanPageTree(spaceSlug)
}

func (s *PageService) EnrichTreeWithDB(nodes []*model.PageNode, spaceID int) {
	// Get all pages from database for this space
	dbPages, err := s.pageRepo.ListBySpaceID(spaceID)
	if err != nil {
		return
	}

	// Build a lookup map by file_path
	pathMap := make(map[string]*model.Page)
	for _, p := range dbPages {
		pathMap[p.FilePath] = p
	}

	// Enrich nodes recursively using exact path matching
	s.enrichNodes(nodes, pathMap)
}

func (s *PageService) enrichNodes(nodes []*model.PageNode, pathMap map[string]*model.Page) {
	for _, node := range nodes {
		// Use exact file path matching if available
		if node.FilePath != "" {
			if page, ok := pathMap[node.FilePath]; ok {
				node.ID = page.ID
				if page.Icon != "" {
					node.Icon = page.Icon
				}
				if page.SortOrder != 0 {
					node.SortOrder = page.SortOrder
				}
				if page.Title != "" {
					node.Title = page.Title
				}
			}
		}

		if len(node.Children) > 0 {
			s.enrichNodes(node.Children, pathMap)
		}
	}
}

func (s *PageService) GetByID(spaceSlug string, pageID int) (*model.Page, error) {
	page, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	// Read content from file
	filePath := filepath.Join(s.docsDir, page.FilePath)
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read page content: %w", err)
	}

	page.Content = string(content)
	return page, nil
}

func (s *PageService) Create(spaceSlug string, req *model.CreatePageRequest, spaceID int) (*model.Page, error) {
	// Determine file path
	var parentPath string
	if req.ParentID != nil {
		parentPage, err := s.pageRepo.GetByID(*req.ParentID)
		if err != nil {
			return nil, fmt.Errorf("parent page not found: %w", err)
		}

		// Get parent directory (file without .md)
		parentDir := strings.TrimSuffix(parentPage.FilePath, ".md")
		parentPath = parentDir
	} else {
		// Root level - use space slug as directory
		parentPath = spaceSlug
	}

	// Create directory if it doesn't exist
	pageDir := filepath.Join(s.docsDir, parentPath, req.Title)
	if err := os.MkdirAll(pageDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create page directory: %w", err)
	}

	// Create .md file
	fileName := req.Title + ".md"
	filePath := filepath.Join(pageDir, fileName)
	filePath = strings.TrimPrefix(filePath, s.docsDir+"/")

	// Create initial content
	content := "# " + req.Title
	if err := os.WriteFile(filepath.Join(s.docsDir, filePath), []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("failed to create page file: %w", err)
	}

	// Create database record
	page := &model.Page{
		SpaceID:   spaceID,
		Title:     req.Title,
		FilePath:  filePath,
		Icon:      req.Icon,
		SortOrder: float64(time.Now().Unix()),
	}

	return s.pageRepo.Create(page)
}

func (s *PageService) Update(spaceSlug string, pageID int, req *model.UpdatePageRequest) (*model.Page, error) {
	page, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	// Update file content
	filePath := filepath.Join(s.docsDir, page.FilePath)
	if err := os.WriteFile(filePath, []byte(req.Content), 0644); err != nil {
		return nil, fmt.Errorf("failed to update page content: %w", err)
	}

	// Update database
	return s.pageRepo.Update(pageID, req)
}

func (s *PageService) UpdateMeta(spaceSlug string, pageID int, req *model.UpdatePageMetaRequest) (*model.Page, error) {
	_, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	// If cover URL is provided, it's already handled (uploaded separately)
	return s.pageRepo.UpdateMeta(pageID, req)
}

func (s *PageService) Delete(spaceSlug string, pageID int) error {
	page, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return err
	}

	// Delete file and directory
	filePath := filepath.Join(s.docsDir, page.FilePath)

	// Get directory (file without .md)
	fileDir := strings.TrimSuffix(filePath, ".md")

	// Remove the directory and all its contents
	if err := os.RemoveAll(fileDir); err != nil {
		return fmt.Errorf("failed to delete page directory: %w", err)
	}

	// Delete from database
	return s.pageRepo.Delete(pageID)
}

func (s *PageService) GetAssetPath(spaceSlug string, pageID int, assetPath string) (string, error) {
	page, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return "", err
	}

	// Get the page directory
	pageDir := strings.TrimSuffix(page.FilePath, ".md")

	// Build full path
	fullPath := filepath.Join(s.docsDir, pageDir, "public", assetPath)

	// Security check: ensure path is within docs directory
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	absDocsDir, err := filepath.Abs(s.docsDir)
	if err != nil {
		return "", err
	}

	if !strings.HasPrefix(absPath, absDocsDir) {
		return "", errors.New("invalid asset path")
	}

	// Check if file exists
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return "", errors.New("asset not found")
	}

	return absPath, nil
}

func (s *PageService) UploadAsset(spaceSlug string, pageID int, filename string, content []byte) (string, error) {
	page, err := s.pageRepo.GetByID(pageID)
	if err != nil {
		return "", err
	}

	// Get the page directory
	pageDir := strings.TrimSuffix(page.FilePath, ".md")

	// Generate UUIDs for path
	uuid1 := uuid.New().String()
	uuid2 := uuid.New().String()

	// Create public directory if it doesn't exist
	publicDir := filepath.Join(s.docsDir, pageDir, "public", uuid1, uuid2)
	if err := os.MkdirAll(publicDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create public directory: %w", err)
	}

	// Save file
	filePath := filepath.Join(publicDir, filename)
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return "", fmt.Errorf("failed to save asset: %w", err)
	}

	// Return relative path
	return filepath.Join(uuid1, uuid2, filename), nil
}
