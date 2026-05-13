package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/repository"
	"github.com/alwaysking/mdlibrary/pkg/filesystem"
	"github.com/alwaysking/mdlibrary/pkg/frontmatter"
	"github.com/google/uuid"
)

type PageService struct {
	docsDir string
	repos   map[string]*repository.PageRepository
	dbs     map[string]interface{ Close() error }
	mu      sync.RWMutex
}

// resolveSpaceDir finds the actual directory for a space slug.
// Returns the full path and the actual directory name.
func (s *PageService) resolveSpaceDir(spaceSlug string) (string, string) {
	// Try exact slug match first
	exactPath := filepath.Join(s.docsDir, spaceSlug)
	if info, err := os.Stat(exactPath); err == nil && info.IsDir() {
		return exactPath, spaceSlug
	}

	// Scan directories and match by generated slug
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return "", ""
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dirName := entry.Name()
		slug := strings.ToLower(dirName)
		slug = strings.ReplaceAll(slug, " ", "-")
		re := regexp.MustCompile("[^a-z0-9-]")
		slug = re.ReplaceAllString(slug, "")
		re2 := regexp.MustCompile("-+")
		slug = re2.ReplaceAllString(slug, "-")
		slug = strings.Trim(slug, "-")
		if slug == spaceSlug {
			return filepath.Join(s.docsDir, dirName), dirName
		}
	}
	return "", ""
}

func NewPageService(docsDir string) *PageService {
	return &PageService{
		docsDir: docsDir,
		repos:   make(map[string]*repository.PageRepository),
		dbs:     make(map[string]interface{ Close() error }),
	}
}

// getRepo returns the PageRepository for the given space slug.
// Opens the space's .cache.db if not already open.
func (s *PageService) getRepo(spaceSlug string) (*repository.PageRepository, error) {
	s.mu.RLock()
	repo, ok := s.repos[spaceSlug]
	s.mu.RUnlock()
	if ok {
		return repo, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Double-check after acquiring write lock
	if repo, ok := s.repos[spaceSlug]; ok {
		return repo, nil
	}

	// Resolve actual directory name (slug may differ from dir name)
	spaceDir, _ := s.resolveSpaceDir(spaceSlug)
	if spaceDir == "" {
		return nil, fmt.Errorf("space directory not found for slug: %s", spaceSlug)
	}

	db, err := repository.OpenSpaceDB(spaceDir)
	if err != nil {
		return nil, fmt.Errorf("failed to open space database: %w", err)
	}

	repo = repository.NewPageRepository(db)
	s.repos[spaceSlug] = repo
	s.dbs[spaceSlug] = db
	return repo, nil
}

// CloseAll closes all open space database connections.
func (s *PageService) CloseAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, db := range s.dbs {
		db.Close()
	}
	s.repos = make(map[string]*repository.PageRepository)
	s.dbs = make(map[string]interface{ Close() error })
}

// RebuildCache closes the space's cache DB, deletes it, and rebuilds from filesystem.
func (s *PageService) RebuildCache(spaceSlug string) error {
	spaceDir, _ := s.resolveSpaceDir(spaceSlug)
	if spaceDir == "" {
		return fmt.Errorf("space directory not found for slug: %s", spaceSlug)
	}

	// Close existing connection and remove from memory
	s.mu.Lock()
	if db, ok := s.dbs[spaceSlug]; ok {
		db.Close()
		delete(s.dbs, spaceSlug)
		delete(s.repos, spaceSlug)
	}
	s.mu.Unlock()

	// Delete the cache DB file
	cachePath := filepath.Join(spaceDir, ".cache.db")
	os.Remove(cachePath)

	// Re-scan and rebuild: open new DB, scan tree, enrich
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return err
	}

	scanner := filesystem.NewScanner(s.docsDir)
	nodes, err := scanner.ScanPageTree(spaceSlug)
	if err != nil {
		return err
	}

	// Create cache entries for all pages
	s.rebuildNodes(nodes, repo)
	return nil
}

func (s *PageService) rebuildNodes(nodes []*model.PageNode, repo *repository.PageRepository) {
	for _, node := range nodes {
		if node.FilePath != "" {
			created, err := repo.Create(&model.Page{
				Title:     node.Title,
				FilePath:  node.FilePath,
				SortOrder: float64(time.Now().UnixNano()),
			})
			if err == nil {
				node.ID = created.ID
			}
		}
		if len(node.Children) > 0 {
			s.rebuildNodes(node.Children, repo)
		}
	}
}

// --- Helper methods ---

func (s *PageService) resolveCoverURL(spaceSlug string, pageID int, coverPath string) string {
	if coverPath == "" {
		return ""
	}
	if strings.HasPrefix(coverPath, "./public/") {
		assetPart := strings.TrimPrefix(coverPath, "./public/")
		return fmt.Sprintf("/api/spaces/%s/pages/%d/assets/%s", spaceSlug, pageID, assetPart)
	}
	return coverPath
}

func (s *PageService) toRelativeCover(coverURL string) string {
	if coverURL == "" {
		return ""
	}
	idx := strings.Index(coverURL, "/assets/")
	if idx != -1 {
		assetPart := coverURL[idx+len("/assets/"):]
		return "./public/" + assetPart
	}
	return coverURL
}

func (s *PageService) resolveUniqueTitle(dir string, title string, skipDir string) string {
	baseTitle := title
	counter := 2
	for {
		candidateFile := filepath.Join(dir, title+".md")
		candidateDir := filepath.Join(dir, title)
		if candidateDir == skipDir {
			title = fmt.Sprintf("%s %d", baseTitle, counter)
			counter++
			continue
		}
		if _, err := os.Stat(candidateFile); os.IsNotExist(err) {
			if _, err := os.Stat(candidateDir); os.IsNotExist(err) {
				break
			}
		}
		title = fmt.Sprintf("%s %d", baseTitle, counter)
		counter++
	}
	return title
}

// --- Core methods ---

func (s *PageService) GetTree(spaceSlug string) ([]*model.PageNode, error) {
	scanner := filesystem.NewScanner(s.docsDir)
	return scanner.ScanPageTree(spaceSlug)
}

func (s *PageService) EnrichTreeWithDB(spaceSlug string, nodes []*model.PageNode) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return
	}

	dbPages, err := repo.ListAll()
	if err != nil {
		return
	}

	pathMap := make(map[string]*model.Page)
	for _, p := range dbPages {
		pathMap[p.FilePath] = p
	}

	s.enrichNodes(spaceSlug, nodes, pathMap, repo)
}

func (s *PageService) enrichNodes(spaceSlug string, nodes []*model.PageNode, pathMap map[string]*model.Page, repo *repository.PageRepository) {
	for _, node := range nodes {
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
			} else {
				created, err := repo.Create(&model.Page{
					Title:     node.Title,
					FilePath:  node.FilePath,
					SortOrder: float64(time.Now().UnixNano()),
				})
				if err == nil {
					node.ID = created.ID
					pathMap[node.FilePath] = created
				}
			}
		}

		if len(node.Children) > 0 {
			s.enrichNodes(spaceSlug, node.Children, pathMap, repo)
		}
	}
}

func (s *PageService) GetByID(spaceSlug string, pageID int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(s.docsDir, page.FilePath)
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read page content: %w", err)
	}

	fm, body, _ := frontmatter.Parse(raw)
	if fm.Icon != "" {
		page.Icon = fm.Icon
	}
	if fm.Cover != "" {
		page.CoverURL = s.resolveCoverURL(spaceSlug, pageID, fm.Cover)
	}
	if fm.FullPage != nil {
		page.FullPage = *fm.FullPage
	}
	page.Content = body

	return page, nil
}

func (s *PageService) Create(spaceSlug string, req *model.CreatePageRequest, spaceID int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	title := req.Title

	if req.ParentID != nil {
		parentPage, err := repo.GetByID(*req.ParentID)
		if err != nil {
			return nil, fmt.Errorf("parent page not found: %w", err)
		}

		parentFileName := filepath.Base(parentPage.FilePath)
		parentName := strings.TrimSuffix(parentFileName, ".md")
		parentRelDir := filepath.Dir(parentPage.FilePath)

		childDir := filepath.Join(parentRelDir, parentName)
		childAbsDir := filepath.Join(s.docsDir, childDir)

		if err := os.MkdirAll(childAbsDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create child directory: %w", err)
		}

		title = s.resolveUniqueTitle(childAbsDir, title, "")

		childRelPath := filepath.Join(childDir, title+".md")
		fm := frontmatter.FrontmatterData{}
		if req.Icon != "" {
			fm.Icon = req.Icon
		}
		fileBytes := frontmatter.Render(fm, "")
		if err := os.WriteFile(filepath.Join(s.docsDir, childRelPath), fileBytes, 0644); err != nil {
			return nil, fmt.Errorf("failed to create child page: %w", err)
		}

		page := &model.Page{
			Title:     title,
			FilePath:  childRelPath,
			Icon:      req.Icon,
			SortOrder: float64(time.Now().Unix()),
		}
		return repo.Create(page)
	}

	// Root level
	title = s.resolveUniqueTitle(filepath.Join(s.docsDir, spaceSlug), title, "")
	relPath := filepath.Join(spaceSlug, title+".md")

	rootFm := frontmatter.FrontmatterData{}
	if req.Icon != "" {
		rootFm.Icon = req.Icon
	}
	rootFileBytes := frontmatter.Render(rootFm, "")
	if err := os.WriteFile(filepath.Join(s.docsDir, relPath), rootFileBytes, 0644); err != nil {
		return nil, fmt.Errorf("failed to create page: %w", err)
	}

	page := &model.Page{
		Title:     title,
		FilePath:  relPath,
		Icon:      req.Icon,
		SortOrder: float64(time.Now().Unix()),
	}
	return repo.Create(page)
}

func (s *PageService) Update(spaceSlug string, pageID int, req *model.UpdatePageRequest) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(s.docsDir, page.FilePath)
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read page file: %w", err)
	}
	fm, _, _ := frontmatter.Parse(raw)
	assembled := frontmatter.Render(fm, req.Content)
	if err := os.WriteFile(filePath, assembled, 0644); err != nil {
		return nil, fmt.Errorf("failed to update page content: %w", err)
	}

	return repo.Update(pageID, req)
}

func (s *PageService) UpdateMeta(spaceSlug string, pageID int, req *model.UpdatePageMetaRequest) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return nil, err
	}

	absPath := filepath.Join(s.docsDir, page.FilePath)
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read page file: %w", err)
	}
	fm, body, _ := frontmatter.Parse(raw)

	if req.Icon != nil {
		fm.Icon = *req.Icon
	}
	if req.CoverURL != nil {
		fm.Cover = s.toRelativeCover(*req.CoverURL)
	}
	if req.FullPage != nil {
		fm.FullPage = req.FullPage
	}

	if req.Title != nil && *req.Title != "" && *req.Title != page.Title {
		newTitle := *req.Title
		pageName := strings.TrimSuffix(filepath.Base(page.FilePath), ".md")
		parentDir := filepath.Dir(absPath)

		newTitle = s.resolveUniqueTitle(parentDir, newTitle, "")

		newMD := filepath.Join(parentDir, newTitle+".md")
		if err := os.Rename(absPath, newMD); err != nil {
			return nil, fmt.Errorf("failed to rename file: %w", err)
		}

		oldChildDir := filepath.Join(parentDir, pageName)
		newChildDir := filepath.Join(parentDir, newTitle)
		if _, err := os.Stat(oldChildDir); err == nil {
			os.Rename(oldChildDir, newChildDir)
		}

		parentRelDir := filepath.Dir(page.FilePath)
		newRelPath := filepath.Join(parentRelDir, newTitle+".md")
		if err := repo.UpdateFilePath(pageID, newRelPath); err != nil {
			return nil, err
		}
		absPath = newMD

		req = &model.UpdatePageMetaRequest{
			Title:     &newTitle,
			Icon:      &fm.Icon,
			CoverURL:  req.CoverURL,
			FullPage:  fm.FullPage,
			SortOrder: req.SortOrder,
		}
	}

	assembled := frontmatter.Render(fm, body)
	if err := os.WriteFile(absPath, assembled, 0644); err != nil {
		return nil, fmt.Errorf("failed to write frontmatter: %w", err)
	}

	return repo.UpdateMeta(pageID, req)
}

func (s *PageService) Delete(spaceSlug string, pageID int) error {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return err
	}

	absPath := filepath.Join(s.docsDir, page.FilePath)
	pageName := strings.TrimSuffix(filepath.Base(page.FilePath), ".md")
	parentDir := filepath.Dir(absPath)

	relPath := strings.TrimPrefix(page.FilePath, spaceSlug+"/")
	fileName := filepath.Base(relPath)
	parentRel := strings.TrimSuffix(relPath, "/"+fileName)

	var trashSub string
	if parentRel == "" {
		trashSub = filepath.Join("_", fileName)
	} else {
		trashSub = filepath.Join(strings.ReplaceAll(parentRel, "/", "_"), fileName)
	}

	trashDir := filepath.Join(s.docsDir, spaceSlug, ".trash", filepath.Dir(trashSub))
	os.MkdirAll(trashDir, 0755)

	trashFile := filepath.Join(s.docsDir, spaceSlug, ".trash", trashSub)
	if err := os.Rename(absPath, trashFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to move page to trash: %w", err)
	}

	childDir := filepath.Join(parentDir, pageName)
	if _, err := os.Stat(childDir); err == nil {
		trashChild := strings.TrimSuffix(trashFile, ".md")
		os.Rename(childDir, trashChild)
	}

	return repo.Delete(pageID)
}

func (s *PageService) GetAssetPath(spaceSlug string, pageID int, assetPath string) (string, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return "", err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return "", err
	}

	pageDir := filepath.Dir(page.FilePath)
	fullPath := filepath.Join(s.docsDir, pageDir, "public", assetPath)

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

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return "", errors.New("asset not found")
	}

	return absPath, nil
}

func (s *PageService) UploadAsset(spaceSlug string, pageID int, filename string, content []byte) (string, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return "", err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return "", err
	}

	pageDir := filepath.Dir(page.FilePath)
	id := uuid.New().String()

	publicDir := filepath.Join(s.docsDir, pageDir, "public", id)
	if err := os.MkdirAll(publicDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create public directory: %w", err)
	}

	filePath := filepath.Join(publicDir, filename)
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		return "", fmt.Errorf("failed to save asset: %w", err)
	}

	return filepath.Join(id, filename), nil
}

// --- Trash ---

type TrashedItem struct {
	Name       string `json:"name"`
	TrashPath  string `json:"trash_path"`
	ParentPath string `json:"parent_path"`
	FileName   string `json:"file_name"`
}

func (s *PageService) ListTrash(spaceSlug string) ([]TrashedItem, error) {
	trashDir := filepath.Join(s.docsDir, spaceSlug, ".trash")
	if _, err := os.Stat(trashDir); os.IsNotExist(err) {
		return []TrashedItem{}, nil
	}

	var items []TrashedItem
	err := filepath.WalkDir(trashDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}

		relPath, _ := filepath.Rel(trashDir, path)
		fileName := filepath.Base(relPath)
		pageName := strings.TrimSuffix(fileName, ".md")
		dirPart := filepath.Dir(relPath)

		var parentPath string
		if dirPart == "_" {
			parentPath = ""
		} else {
			parentPath = strings.ReplaceAll(dirPart, "_", "/")
		}

		trashRelPath := filepath.Join(spaceSlug, ".trash", relPath)

		items = append(items, TrashedItem{
			Name:       pageName,
			TrashPath:  trashRelPath,
			ParentPath: parentPath,
			FileName:   fileName,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []TrashedItem{}
	}
	return items, nil
}

func (s *PageService) RestoreFromTrash(spaceSlug string, trashRelPath string, spaceID int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	trashAbsPath := filepath.Join(s.docsDir, trashRelPath)
	if _, err := os.Stat(trashAbsPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("trashed item not found")
	}

	fileName := filepath.Base(trashRelPath)
	pageName := strings.TrimSuffix(fileName, ".md")

	afterTrash := strings.TrimPrefix(trashRelPath, spaceSlug+"/.trash/")
	dirPart := filepath.Dir(afterTrash)

	var parentPath string
	if dirPart == "_" {
		parentPath = ""
	} else {
		parentPath = strings.ReplaceAll(dirPart, "_", "/")
	}

	var targetRelPath string
	if parentPath == "" {
		targetRelPath = filepath.Join(spaceSlug, fileName)
	} else {
		parentAbsDir := filepath.Join(s.docsDir, spaceSlug, parentPath)
		if _, err := os.Stat(parentAbsDir); err == nil {
			targetRelPath = filepath.Join(spaceSlug, parentPath, fileName)
		} else {
			targetRelPath = filepath.Join(spaceSlug, fileName)
		}
	}

	targetAbsPath := filepath.Join(s.docsDir, targetRelPath)

	title := pageName
	counter := 2
	for {
		if _, err := os.Stat(targetAbsPath); os.IsNotExist(err) {
			break
		}
		title = fmt.Sprintf("%s %d", pageName, counter)
		targetRelPath = filepath.Join(filepath.Dir(targetRelPath), title+".md")
		targetAbsPath = filepath.Join(s.docsDir, targetRelPath)
		counter++
	}

	if err := os.Rename(trashAbsPath, targetAbsPath); err != nil {
		return nil, fmt.Errorf("failed to restore file: %w", err)
	}

	trashChildDir := strings.TrimSuffix(trashAbsPath, ".md")
	if info, err := os.Stat(trashChildDir); err == nil && info.IsDir() {
		targetChildDir := filepath.Join(filepath.Dir(targetAbsPath), title)
		os.Rename(trashChildDir, targetChildDir)
	}

	page := &model.Page{
		Title:     title,
		FilePath:  targetRelPath,
		SortOrder: float64(time.Now().Unix()),
	}
	return repo.Create(page)
}

func (s *PageService) PermanentDelete(spaceSlug string, trashRelPath string) error {
	trashAbsPath := filepath.Join(s.docsDir, trashRelPath)
	if err := os.Remove(trashAbsPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete: %w", err)
	}
	trashChildDir := strings.TrimSuffix(trashAbsPath, ".md")
	if _, err := os.Stat(trashChildDir); err == nil {
		os.RemoveAll(trashChildDir)
	}
	return nil
}
