package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
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

// cleanupLocalAsset removes a local asset file (icon image) from a page's public directory.
// The iconURL is expected to be an API path like /api/spaces/{slug}/pages/{id}/assets/{uuid}/file.png
// or a relative path like ./public/{uuid}/file.png.
func (s *PageService) cleanupLocalAsset(spaceSlug string, pageFilePath string, iconURL string) {
	var assetPart string
	if strings.HasPrefix(iconURL, "/api/spaces/") {
		idx := strings.Index(iconURL, "/assets/")
		if idx == -1 {
			return
		}
		assetPart = iconURL[idx+len("/assets/"):]
	} else if strings.HasPrefix(iconURL, "./public/") {
		assetPart = strings.TrimPrefix(iconURL, "./public/")
	} else {
		return // not a local asset
	}

	pageDir := filepath.Dir(pageFilePath)
	absAssetPath := filepath.Join(s.docsDir, pageDir, "public", assetPart)

	// Safety: ensure path is under docs dir
	absDocsDir, err := filepath.Abs(s.docsDir)
	if err != nil {
		return
	}
	absResolved, err := filepath.Abs(absAssetPath)
	if err != nil {
		return
	}
	if !strings.HasPrefix(absResolved, absDocsDir) {
		return
	}

	// Remove the file and its parent uuid directory if empty
	os.Remove(absResolved)
	parentDir := filepath.Dir(absResolved)
	if entries, err := os.ReadDir(parentDir); err == nil && len(entries) == 0 {
		os.Remove(parentDir)
	}
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
	sortNodesByOrder(nodes)
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

// sortNodesByOrder recursively sorts page nodes by sort_order ASC.
func sortNodesByOrder(nodes []*model.PageNode) {
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].SortOrder < nodes[j].SortOrder
	})
	for _, node := range nodes {
		if len(node.Children) > 0 {
			sortNodesByOrder(node.Children)
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
	if fm.IconLarge != nil {
		page.IconLarge = *fm.IconLarge
	}
	if fm.CoverOffset != nil {
		page.CoverOffset = *fm.CoverOffset
	}
	if fm.Starred != nil {
		page.IsStarred = *fm.Starred
	}
	page.Content = body

	// Track page access for "recent" feature
	repo.TouchAccess(pageID)

	// Maintain subpage blocks: add missing, remove stale
	maintained := s.maintainSubpageBlocks(page.Content, repo, page.FilePath)
	if maintained != page.Content {
		assembled := frontmatter.Render(fm, maintained)
		os.WriteFile(filePath, assembled, 0644)
		page.Content = maintained
	}

	return page, nil
}

func (s *PageService) Create(spaceSlug string, req *model.CreatePageRequest, spaceID int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	// Resolve actual directory name
	spaceDir, dirName := s.resolveSpaceDir(spaceSlug)
	if spaceDir == "" {
		return nil, fmt.Errorf("space not found: %s", spaceSlug)
	}

	title := req.Title

	maxSort, _ := repo.MaxSortOrder()
	sortOrder := maxSort + 1

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
			SortOrder: sortOrder,
		}
		created, err := repo.Create(page)
		if err != nil {
			return nil, err
		}
		// Append subpage block to parent
		s.appendSubpageToParent(repo, *req.ParentID, created.ID)
		return created, nil
	}

	// Root level
	title = s.resolveUniqueTitle(spaceDir, title, "")
	relPath := filepath.Join(dirName, title+".md")

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
		SortOrder: sortOrder,
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
		// Clean up old local icon file when icon is being changed
		if fm.Icon != "" && fm.Icon != *req.Icon {
			s.cleanupLocalAsset(spaceSlug, page.FilePath, fm.Icon)
		}
		fm.Icon = *req.Icon
	}
	if req.CoverURL != nil {
		// Clean up old local cover file when cover is being changed or removed
		if fm.Cover != "" && fm.Cover != s.toRelativeCover(*req.CoverURL) {
			s.cleanupLocalAsset(spaceSlug, page.FilePath, fm.Cover)
		}
		fm.Cover = s.toRelativeCover(*req.CoverURL)
	}
	if req.FullPage != nil {
		fm.FullPage = req.FullPage
	}
	if req.IconLarge != nil {
		fm.IconLarge = req.IconLarge
	}
	if req.CoverOffset != nil {
		fm.CoverOffset = req.CoverOffset
	}
	if req.IsStarred != nil {
		fm.Starred = req.IsStarred
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

	// Update SQL fields (title, icon, cover_url, etc.)
	if _, err := repo.UpdateMeta(pageID, req); err != nil {
		return nil, err
	}

	// Re-read the page to pick up frontmatter-only fields (icon_large, etc.)
	return s.GetByID(spaceSlug, pageID)
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

	// Resolve actual directory name (may differ from slug in case)
	spaceDir, dirName := s.resolveSpaceDir(spaceSlug)
	if spaceDir == "" {
		return fmt.Errorf("space not found: %s", spaceSlug)
	}

	absPath := filepath.Join(s.docsDir, page.FilePath)
	pageName := strings.TrimSuffix(filepath.Base(page.FilePath), ".md")
	parentDir := filepath.Dir(absPath)

	relPath := strings.TrimPrefix(page.FilePath, dirName+"/")
	fileName := filepath.Base(relPath)
	parentRel := strings.TrimSuffix(relPath, "/"+fileName)

	var trashSub string
	if parentRel == "" {
		trashSub = filepath.Join("_", fileName)
	} else {
		trashSub = filepath.Join(strings.ReplaceAll(parentRel, "/", "_"), fileName)
	}

	trashDir := filepath.Join(spaceDir, ".trash", filepath.Dir(trashSub))
	os.MkdirAll(trashDir, 0755)

	trashFile := filepath.Join(spaceDir, ".trash", trashSub)
	if err := os.Rename(absPath, trashFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to move page to trash: %w", err)
	}

	childDir := filepath.Join(parentDir, pageName)
	if _, err := os.Stat(childDir); err == nil {
		trashChild := strings.TrimSuffix(trashFile, ".md")
		os.Rename(childDir, trashChild)
	}

	// Remove subpage block from parent page
	parentID := s.findParentPageID(repo, page.FilePath)
	if parentID != nil {
		s.removeSubpageFromParent(repo, *parentID, pageID)
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

	maxSort, _ := repo.MaxSortOrder()
	page := &model.Page{
		Title:     title,
		FilePath:  targetRelPath,
		SortOrder: maxSort + 1,
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

// Duplicate creates a copy of a page (and its entire subtree) under an optional target parent.
// If targetParentID is nil, the duplicate is placed at the space root.
func (s *PageService) Duplicate(spaceSlug string, pageID int, targetParentID *int, spaceID int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	// Read the original page
	origPage, err := repo.GetByID(pageID)
	if err != nil {
		return nil, fmt.Errorf("source page not found: %w", err)
	}

	// Read the original file content + frontmatter
	absPath := filepath.Join(s.docsDir, origPage.FilePath)
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read source page: %w", err)
	}
	fm, body, _ := frontmatter.Parse(raw)

	// Determine target directory
	var targetDir string // absolute path to directory where the new .md goes
	var targetRelDir string
	newTitle := origPage.Title + " 副本"

	if targetParentID != nil {
		parentPage, err := repo.GetByID(*targetParentID)
		if err != nil {
			return nil, fmt.Errorf("target parent not found: %w", err)
		}
		parentFileName := filepath.Base(parentPage.FilePath)
		parentName := strings.TrimSuffix(parentFileName, ".md")
		parentRelDir := filepath.Dir(parentPage.FilePath)
		childRelDir := filepath.Join(parentRelDir, parentName)
		targetDir = filepath.Join(s.docsDir, childRelDir)
		targetRelDir = childRelDir
	} else {
		spaceDir, _ := s.resolveSpaceDir(spaceSlug)
		targetDir = spaceDir
		targetRelDir = spaceSlug
	}

	// Ensure target directory exists
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create target directory: %w", err)
	}

	// Resolve unique title in target directory
	newTitle = s.resolveUniqueTitle(targetDir, newTitle, "")

	// Write new .md file with same frontmatter + content
	newRelPath := filepath.Join(targetRelDir, newTitle+".md")
	newAbsPath := filepath.Join(s.docsDir, newRelPath)
	fileBytes := frontmatter.Render(fm, body)
	if err := os.WriteFile(newAbsPath, fileBytes, 0644); err != nil {
		return nil, fmt.Errorf("failed to write duplicate page: %w", err)
	}

	// Copy child directory tree if it exists
	origName := strings.TrimSuffix(filepath.Base(origPage.FilePath), ".md")
	origChildDir := filepath.Join(filepath.Dir(absPath), origName)
	if info, err := os.Stat(origChildDir); err == nil && info.IsDir() {
		newChildDir := filepath.Join(targetDir, newTitle)
		if err := copyDirRecursive(origChildDir, newChildDir); err != nil {
			return nil, fmt.Errorf("failed to copy child pages: %w", err)
		}
	}

	// Rebuild cache to discover all new files
	if err := s.RebuildCache(spaceSlug); err != nil {
		return nil, fmt.Errorf("failed to rebuild cache: %w", err)
	}

	// Find the new page by its file path
	repo, err = s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}
	return repo.GetByPath(newRelPath)
}

// copyDirRecursive copies a directory tree from src to dst.
func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relPath, _ := filepath.Rel(src, path)
		targetPath := filepath.Join(dst, relPath)

		if d.IsDir() {
			return os.MkdirAll(targetPath, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(targetPath, data, 0644)
	})
}

// Move relocates a page (and its subtree) to a new parent.
// If targetParentID is nil, the page is moved to the space root.
func (s *PageService) Move(spaceSlug string, pageID int, targetParentID *int) (*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	// Get the page to move
	page, err := repo.GetByID(pageID)
	if err != nil {
		return nil, fmt.Errorf("page not found: %w", err)
	}

	absPath := filepath.Join(s.docsDir, page.FilePath)
	pageName := strings.TrimSuffix(filepath.Base(page.FilePath), ".md")
	parentDir := filepath.Dir(absPath)
	childDir := filepath.Join(parentDir, pageName)

	// Remember old parent before move (paths change after move)
	oldParentID := s.findParentPageID(repo, page.FilePath)

	// Determine target directory
	var targetDir string    // absolute
	var targetRelDir string // relative to docsDir

	if targetParentID != nil {
		// Validate: target parent cannot be self or a descendant
		if *targetParentID == pageID {
			return nil, fmt.Errorf("cannot move a page into itself")
		}
		targetParent, err := repo.GetByID(*targetParentID)
		if err != nil {
			return nil, fmt.Errorf("target parent not found: %w", err)
		}
		// Check if target is a descendant of the page being moved
		if strings.HasPrefix(targetParent.FilePath, strings.TrimSuffix(page.FilePath, ".md")+"/") {
			return nil, fmt.Errorf("cannot move a page into its own descendant")
		}

		tpFileName := filepath.Base(targetParent.FilePath)
		tpName := strings.TrimSuffix(tpFileName, ".md")
		tpRelDir := filepath.Dir(targetParent.FilePath)
		childRelDir := filepath.Join(tpRelDir, tpName)
		targetDir = filepath.Join(s.docsDir, childRelDir)
		targetRelDir = childRelDir
	} else {
		spaceDir, _ := s.resolveSpaceDir(spaceSlug)
		targetDir = spaceDir
		targetRelDir = spaceSlug
	}

	// Ensure target directory exists
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create target directory: %w", err)
	}

	// Resolve unique title (skip own directory which will be vacated)
	newTitle := s.resolveUniqueTitle(targetDir, page.Title, "")

	// Move .md file
	newRelPath := filepath.Join(targetRelDir, newTitle+".md")
	newAbsPath := filepath.Join(s.docsDir, newRelPath)
	if err := os.Rename(absPath, newAbsPath); err != nil {
		return nil, fmt.Errorf("failed to move page file: %w", err)
	}

	// Move child directory if exists
	if info, err := os.Stat(childDir); err == nil && info.IsDir() {
		newChildDir := filepath.Join(targetDir, newTitle)
		if err := os.Rename(childDir, newChildDir); err != nil {
			return nil, fmt.Errorf("failed to move child directory: %w", err)
		}
	}

	// Rebuild cache to update all paths
	if err := s.RebuildCache(spaceSlug); err != nil {
		return nil, fmt.Errorf("failed to rebuild cache: %w", err)
	}

	// Find the moved page by its new file path
	repo, err = s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}

	// Maintain subpage blocks: remove from old parent, add to new parent
	if oldParentID != nil {
		s.removeSubpageFromParent(repo, *oldParentID, pageID)
	}
	if targetParentID != nil {
		s.appendSubpageToParent(repo, *targetParentID, pageID)
	}

	return repo.GetByPath(newRelPath)
}

// ListStarred returns all starred pages for a space
func (s *PageService) ListStarred(spaceSlug string) ([]*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}
	return repo.ListStarred()
}

// ListRecent returns recently accessed pages for a space
func (s *PageService) ListRecent(spaceSlug string, limit int) ([]*model.Page, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 10
	}
	return repo.ListRecent(limit)
}

// ==================== Subpage Block Maintenance ====================
//
// Subpage blocks are HTML comments in markdown: <!-- subpage:123 -->
// They represent direct child pages. All maintenance is done server-side
// so the frontend only needs to render them.

// subpageRe matches <!-- subpage:123 --> lines
var subpageRe = regexp.MustCompile(`^<!--\s*subpage:(\d+)\s*-->$`)

// getDirectChildIDs returns the database IDs of a page's direct child pages.
// Children are determined by filesystem structure: if page is "space/parent.md",
// children are *.md files in "space/parent/" directory.
func (s *PageService) getDirectChildIDs(repo *repository.PageRepository, filePath string) ([]int, error) {
	pageName := strings.TrimSuffix(filepath.Base(filePath), ".md")
	parentDir := filepath.Dir(filePath)
	childDir := filepath.Join(parentDir, pageName)
	childAbsDir := filepath.Join(s.docsDir, childDir)

	entries, err := os.ReadDir(childAbsDir)
	if err != nil {
		// No child directory = no children
		return nil, nil
	}

	var ids []int
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		childRelPath := filepath.Join(childDir, entry.Name())
		childPage, err := repo.GetByPath(childRelPath)
		if err == nil && childPage != nil {
			ids = append(ids, childPage.ID)
		}
	}
	return ids, nil
}

// maintainSubpageBlocks ensures the markdown body has exactly one <!-- subpage:ID -->
// for each direct child page, removing stale ones and appending missing ones.
// Returns the (possibly modified) body.
func (s *PageService) maintainSubpageBlocks(body string, repo *repository.PageRepository, filePath string) string {
	childIDs, err := s.getDirectChildIDs(repo, filePath)
	if err != nil {
		return body
	}

	// Parse existing subpage lines from body
	childIDSet := make(map[int]bool)
	for _, id := range childIDs {
		childIDSet[id] = true
	}

	existingSubpageSet := make(map[int]bool)
	var lines []string
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		matches := subpageRe.FindStringSubmatch(trimmed)
		if len(matches) == 2 {
			id := 0
			fmt.Sscanf(matches[1], "%d", &id)
			if id > 0 {
				existingSubpageSet[id] = true
			}
			// Only keep this line if the ID is a valid direct child
			if id > 0 && childIDSet[id] {
				lines = append(lines, line)
			}
			// else: stale subpage line, drop it
		} else {
			lines = append(lines, line)
		}
	}

	// Find missing subpages (child exists but no line in body)
	var missing []int
	for _, id := range childIDs {
		if !existingSubpageSet[id] {
			missing = append(missing, id)
		}
	}

	if len(missing) == 0 && len(existingSubpageSet) == len(childIDSet) {
		// Nothing changed
		// Rejoin and check equality
		result := strings.Join(lines, "\n")
		// Clean up trailing newlines to match original behavior
		result = strings.TrimRight(result, "\n")
		if result == strings.TrimRight(body, "\n") {
			return body
		}
		return result
	}

	// Append missing subpages at the end
	for _, id := range missing {
		lines = append(lines, fmt.Sprintf("<!-- subpage:%d -->", id))
	}

	result := strings.Join(lines, "\n")
	return strings.TrimRight(result, "\n")
}

// appendSubpageToParent adds <!-- subpage:childID --> to the end of parent page's content.
func (s *PageService) appendSubpageToParent(repo *repository.PageRepository, parentID int, childID int) {
	parent, err := repo.GetByID(parentID)
	if err != nil {
		return
	}

	filePath := filepath.Join(s.docsDir, parent.FilePath)
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return
	}

	fm, body, _ := frontmatter.Parse(raw)

	// Check if subpage line already exists
	target := fmt.Sprintf("<!-- subpage:%d -->", childID)
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == target {
			return // Already exists
		}
	}

	// Append
	if body != "" && !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	body += target

	assembled := frontmatter.Render(fm, body)
	os.WriteFile(filePath, assembled, 0644)
}

// removeSubpageFromParent removes <!-- subpage:childID --> from parent page's content.
func (s *PageService) removeSubpageFromParent(repo *repository.PageRepository, parentID int, childID int) {
	parent, err := repo.GetByID(parentID)
	if err != nil {
		return
	}

	filePath := filepath.Join(s.docsDir, parent.FilePath)
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return
	}

	fm, body, _ := frontmatter.Parse(raw)

	target := fmt.Sprintf("<!-- subpage:%d -->", childID)
	var lines []string
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) != target {
			lines = append(lines, line)
		}
	}

	newBody := strings.Join(lines, "\n")
	newBody = strings.TrimRight(newBody, "\n")

	if newBody == strings.TrimRight(body, "\n") {
		return // Nothing changed
	}

	assembled := frontmatter.Render(fm, newBody)
	os.WriteFile(filePath, assembled, 0644)
}

// findParentPageID determines the parent page ID from a child page's file_path.
// For example, "space/parent/child.md" → looks up "space/parent.md" → returns parent's ID.
// Returns nil if the page is at root level (no parent).
func (s *PageService) findParentPageID(repo *repository.PageRepository, filePath string) *int {
	dir := filepath.Dir(filePath)
	// If the directory is the root (e.g., "space"), there's no parent
	if !strings.Contains(dir, "/") && !strings.Contains(dir, string(filepath.Separator)) {
		return nil
	}

	// Parent .md file is at dir/../dirname.md where dirname is the last path segment
	parentDir := filepath.Dir(dir)
	parentName := filepath.Base(dir)
	parentPath := filepath.Join(parentDir, parentName+".md")

	parent, err := repo.GetByPath(parentPath)
	if err != nil || parent == nil {
		return nil
	}
	return &parent.ID
}
