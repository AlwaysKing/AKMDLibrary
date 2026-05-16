package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
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
	"github.com/alwaysking/mdlibrary/pkg/uuidutil"
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
			// Read frontmatter to get or assign UUID
			pageID := s.ensurePageUUID(node.FilePath)

			created, err := repo.Create(&model.Page{
				ID:        pageID,
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

// ensurePageUUID reads a .md file's frontmatter and ensures it has a UUID.
// If the frontmatter already has an `id`, returns it.
// If not, generates a new UUID, writes it into the frontmatter, and returns it.
func (s *PageService) ensurePageUUID(relPath string) string {
	absPath := filepath.Join(s.docsDir, relPath)
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return uuidutil.NewPageID()
	}

	fm, body, _ := frontmatter.Parse(raw)
	if fm.ID != "" {
		return fm.ID
	}

	// Generate and write UUID into frontmatter
	fm.ID = uuidutil.NewPageID()
	assembled := frontmatter.Render(fm, body)
	os.WriteFile(absPath, assembled, 0644)
	return fm.ID
}

// --- Helper methods ---

func (s *PageService) resolveCoverURL(spaceSlug string, pageID string, coverPath string) string {
	if coverPath == "" {
		return ""
	}
	if strings.HasPrefix(coverPath, "./public/") {
		assetPart := strings.TrimPrefix(coverPath, "./public/")
		return fmt.Sprintf("/api/spaces/%s/pages/%s/assets/%s", spaceSlug, pageID, assetPart)
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
				// Ensure the .md file has a UUID in frontmatter
				pageID := s.ensurePageUUID(node.FilePath)

				created, err := repo.Create(&model.Page{
					ID:        pageID,
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

func (s *PageService) GetByID(spaceSlug string, pageID string) (*model.Page, error) {
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

	// Ensure frontmatter has the page ID (repair if missing)
	if fm.ID == "" {
		fm.ID = pageID
		assembled := frontmatter.Render(fm, body)
		os.WriteFile(filePath, assembled, 0644)
	}

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
	pageID := uuidutil.NewPageID()

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
		fm := frontmatter.FrontmatterData{ID: pageID}
		if req.Icon != "" {
			fm.Icon = req.Icon
		}
		fileBytes := frontmatter.Render(fm, "")
		if err := os.WriteFile(filepath.Join(s.docsDir, childRelPath), fileBytes, 0644); err != nil {
			return nil, fmt.Errorf("failed to create child page: %w", err)
		}

		page := &model.Page{
			ID:        pageID,
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

	rootFm := frontmatter.FrontmatterData{ID: pageID}
	if req.Icon != "" {
		rootFm.Icon = req.Icon
	}
	rootFileBytes := frontmatter.Render(rootFm, "")
	if err := os.WriteFile(filepath.Join(s.docsDir, relPath), rootFileBytes, 0644); err != nil {
		return nil, fmt.Errorf("failed to create page: %w", err)
	}

	page := &model.Page{
		ID:        pageID,
		Title:     title,
		FilePath:  relPath,
		Icon:      req.Icon,
		SortOrder: sortOrder,
	}
	return repo.Create(page)
}

func (s *PageService) Update(spaceSlug string, pageID string, req *model.UpdatePageRequest) (*model.Page, error) {
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

func (s *PageService) UpdateMeta(spaceSlug string, pageID string, req *model.UpdatePageMetaRequest) (*model.Page, error) {
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

func (s *PageService) Delete(spaceSlug string, pageID string) error {
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

func (s *PageService) GetAssetPath(spaceSlug string, pageID string, assetPath string) (string, error) {
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

func (s *PageService) UploadAsset(spaceSlug string, pageID string, filename string, content []byte) (string, error) {
	repo, err := s.getRepo(spaceSlug)
	if err != nil {
		return "", err
	}

	page, err := repo.GetByID(pageID)
	if err != nil {
		return "", err
	}

	pageDir := filepath.Dir(page.FilePath)
	id := uuidutil.NewPageID()

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

	// Ensure restored file has a UUID in frontmatter
	pageID := s.ensurePageUUID(targetRelPath)

	maxSort, _ := repo.MaxSortOrder()
	page := &model.Page{
		ID:        pageID,
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
func (s *PageService) Duplicate(spaceSlug string, pageID string, targetParentID *string, spaceID int) (*model.Page, error) {
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

	// Write new .md file with NEW UUID + same content
	newPageID := uuidutil.NewPageID()
	newFm := frontmatter.FrontmatterData{
		ID:          newPageID,
		Icon:        fm.Icon,
		Cover:       fm.Cover,
		FullPage:    fm.FullPage,
		IconLarge:   fm.IconLarge,
		CoverOffset: fm.CoverOffset,
		Starred:     fm.Starred,
	}
	newRelPath := filepath.Join(targetRelDir, newTitle+".md")
	newAbsPath := filepath.Join(s.docsDir, newRelPath)
	fileBytes := frontmatter.Render(newFm, body)
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
func (s *PageService) Move(spaceSlug string, pageID string, targetParentID *string, afterID *string) (*model.Page, error) {
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

	// Check if this is a same-directory reorder (no file move needed)
	isSameDir := targetDir == parentDir
	var newRelPath string

	if isSameDir {
		// Same directory: just update sort_order, no file rename/move
		newRelPath = page.FilePath
	} else {
		// Cross-directory move: resolve unique title and move files
		newTitle := s.resolveUniqueTitle(targetDir, page.Title, childDir)

		// Move .md file
		newRelPath = filepath.Join(targetRelDir, newTitle+".md")
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
	}

		// Update cache DB: just fix file_path prefixes, no full rebuild needed
		if !isSameDir {
			// Update the moved page and all its children's file_path in cache
			oldRelPrefix := strings.TrimSuffix(page.FilePath, ".md")
			newRelPrefix := strings.TrimSuffix(newRelPath, ".md")
			if err := repo.UpdateFilePathPrefix(oldRelPrefix, newRelPrefix); err != nil {
				return nil, fmt.Errorf("failed to update cache paths: %w", err)
			}
		}

	// Maintain subpage blocks: remove from old parent, add to new parent (skip if same dir)
	if !isSameDir {
		if oldParentID != nil {
			s.removeSubpageFromParent(repo, *oldParentID, pageID)
		}
		if targetParentID != nil {
			s.appendSubpageToParent(repo, *targetParentID, pageID)
		}
	}

	// Recalculate sort_order for siblings in the target directory
	s.recalculateSortOrder(repo, targetRelDir, pageID, afterID)

	return repo.GetByPath(newRelPath)
}

// recalculateSortOrder reorders siblings so the moved page lands at the correct position.
// afterID = nil → first position; afterID = "some-id" → after that sibling.
func (s *PageService) recalculateSortOrder(repo *repository.PageRepository, parentRelDir string, movedPageID string, afterID *string) {
	siblings, err := repo.GetSiblings(parentRelDir)
	if err != nil || len(siblings) == 0 {
		return
	}

	// Remove moved page from list, find insertion index
	var sorted []*model.Page
	var movedPage *model.Page
	for _, p := range siblings {
		if p.ID == movedPageID {
			movedPage = p
			continue
		}
		sorted = append(sorted, p)
	}
	if movedPage == nil {
		return // shouldn't happen
	}

	// Find insertion index
	insertIdx := 0
	if afterID != nil {
		for i, p := range sorted {
			if p.ID == *afterID {
				insertIdx = i + 1
				break
			}
		}
	}

	// Insert moved page at the correct position
	tail := append([]*model.Page{movedPage}, sorted[insertIdx:]...)
	sorted = append(sorted[:insertIdx], tail...)

	// Assign sort_order with gap of 1000
	updates := make([]repository.SortOrderUpdate, len(sorted))
	for i, p := range sorted {
		updates[i] = repository.SortOrderUpdate{
			ID:        p.ID,
			SortOrder: float64((i + 1) * 1000),
		}
	}

	repo.UpdateSortOrders(updates)
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
// Subpage blocks are custom HTML tags in markdown: <sub-page data-id="uuid"></sub-page>
// For backward compatibility, the old comment format <!-- subpage:UUID --> is also read.
// All maintenance is done server-side so the frontend only needs to render them.

// subpageTagRe matches the new custom tag format.
var subpageTagRe = regexp.MustCompile(`^<sub-page\s+data-id="([a-f0-9]{32})"\s*></sub-page>$`)

// subpageCommentRe matches the legacy HTML comment format (for backward-compatible reading).
var subpageCommentRe = regexp.MustCompile(`^<!--\s*subpage:([a-f0-9]{32})\s*-->$`)

// parseSubpageID tries both tag and comment formats, returns the UUID or empty string.
func parseSubpageID(line string) string {
	trimmed := strings.TrimSpace(line)
	if m := subpageTagRe.FindStringSubmatch(trimmed); len(m) == 2 {
		return m[1]
	}
	if m := subpageCommentRe.FindStringSubmatch(trimmed); len(m) == 2 {
		return m[1]
	}
	return ""
}

// formatSubpageTag returns the custom tag for a subpage ID.
func formatSubpageTag(id string) string {
	return fmt.Sprintf(`<sub-page data-id="%s"></sub-page>`, id)
}

// getDirectChildIDs returns the database IDs of a page's direct child pages.
func (s *PageService) getDirectChildIDs(repo *repository.PageRepository, filePath string) ([]string, error) {
	pageName := strings.TrimSuffix(filepath.Base(filePath), ".md")
	parentDir := filepath.Dir(filePath)
	childDir := filepath.Join(parentDir, pageName)
	childAbsDir := filepath.Join(s.docsDir, childDir)

	entries, err := os.ReadDir(childAbsDir)
	if err != nil {
		return nil, nil
	}

	var ids []string
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

// maintainSubpageBlocks ensures the markdown body has exactly one <sub-page data-id="UUID"></sub-page>
// for each direct child page, removing stale ones and appending missing ones.
// Reads both new tag format and legacy comment format; always writes new tag format.
func (s *PageService) maintainSubpageBlocks(body string, repo *repository.PageRepository, filePath string) string {
	childIDs, err := s.getDirectChildIDs(repo, filePath)
	if err != nil {
		return body
	}

	childIDSet := make(map[string]bool)
	for _, id := range childIDs {
		childIDSet[id] = true
	}

	existingSubpageSet := make(map[string]bool)
	var lines []string
	changed := false
	for _, line := range strings.Split(body, "\n") {
		id := parseSubpageID(line)
		if id != "" {
			existingSubpageSet[id] = true
			if childIDSet[id] {
				// Re-write in new tag format (migrates legacy comments on the fly)
				newTag := formatSubpageTag(id)
				if strings.TrimSpace(line) != newTag {
					lines = append(lines, newTag)
					changed = true
				} else {
					lines = append(lines, line)
				}
			} else {
				// Stale subpage line, drop it
				changed = true
			}
		} else {
			lines = append(lines, line)
		}
	}

	// Find missing subpages (child exists but no line in body)
	var missing []string
	for _, id := range childIDs {
		if !existingSubpageSet[id] {
			missing = append(missing, id)
		}
	}

	if len(missing) == 0 && !changed {
		result := strings.Join(lines, "\n")
		result = strings.TrimRight(result, "\n")
		if result == strings.TrimRight(body, "\n") {
			return body
		}
		return result
	}

	// Append missing subpages at the end
	for _, id := range missing {
		lines = append(lines, formatSubpageTag(id))
	}

	result := strings.Join(lines, "\n")
	return strings.TrimRight(result, "\n")
}

// appendSubpageToParent adds <sub-page data-id="childID"></sub-page> to the end of parent page's content.
func (s *PageService) appendSubpageToParent(repo *repository.PageRepository, parentID string, childID string) {
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

	// Check if subpage line already exists (match both tag and comment format)
	for _, line := range strings.Split(body, "\n") {
		id := parseSubpageID(line)
		if id == childID {
			return // Already exists
		}
	}

	// Append in new tag format
	target := formatSubpageTag(childID)
	if body != "" && !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	body += target

	assembled := frontmatter.Render(fm, body)
	os.WriteFile(filePath, assembled, 0644)
}

// removeSubpageFromParent removes the subpage tag/comment for childID from parent page's content.
func (s *PageService) removeSubpageFromParent(repo *repository.PageRepository, parentID string, childID string) {
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

	var lines []string
	for _, line := range strings.Split(body, "\n") {
		id := parseSubpageID(line)
		if id == childID {
			continue // Remove this subpage line
		}
		lines = append(lines, line)
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
// Returns nil if the page is at root level (no parent).
func (s *PageService) findParentPageID(repo *repository.PageRepository, filePath string) *string {
	dir := filepath.Dir(filePath)
	if !strings.Contains(dir, "/") && !strings.Contains(dir, string(filepath.Separator)) {
		return nil
	}

	parentDir := filepath.Dir(dir)
	parentName := filepath.Base(dir)
	parentPath := filepath.Join(parentDir, parentName+".md")

	parent, err := repo.GetByPath(parentPath)
	if err != nil || parent == nil {
		return nil
	}
	return &parent.ID
}

// ==================== UUID Migration ====================
//
// MigrateToUUIDs performs a one-time migration of all per-space .cache.db
// files from INTEGER primary keys to UUID (TEXT) primary keys.
// It also writes UUIDs into every .md file's frontmatter and rewrites
// subpage comments from integer to UUID format.

// oldSubpageRe matches the legacy integer-format subpage comments.
var oldSubpageRe = regexp.MustCompile(`<!--\s*subpage:(\d+)\s*-->`)

func (s *PageService) MigrateToUUIDs() error {
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return fmt.Errorf("failed to read docs directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.Name() == "public" {
			continue
		}

		spaceDir := filepath.Join(s.docsDir, entry.Name())
		if err := s.migrateSpaceDB(spaceDir); err != nil {
			log.Printf("Warning: failed to migrate space %s: %v", entry.Name(), err)
		}
	}

	// Clear any cached repo connections so subsequent requests open the fresh (post-migration) DBs
	s.CloseAll()

	return nil
}

// migrateSpaceDB migrates a single space's .cache.db from integer to UUID primary keys.
func (s *PageService) migrateSpaceDB(spaceDir string) error {
	// Skip if already migrated
	markerPath := filepath.Join(spaceDir, ".uuid-migrated")
	if _, err := os.Stat(markerPath); err == nil {
		return nil
	}

	cachePath := filepath.Join(spaceDir, ".cache.db")
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		// No cache DB yet — write marker and skip
		os.WriteFile(markerPath, []byte("migrated"), 0644)
		return nil
	}

	// Open old DB and check if migration is needed
	oldDB, err := sql.Open("sqlite3", cachePath)
	if err != nil {
		return fmt.Errorf("failed to open old cache db: %w", err)
	}

	needsMigration, err := s.checkCacheNeedsMigration(oldDB)
	if err != nil {
		return fmt.Errorf("failed to check migration status: %w", err)
	}
	if !needsMigration {
		oldDB.Close()
		os.WriteFile(markerPath, []byte("migrated"), 0644)
		return nil
	}

	log.Printf("Migrating space cache to UUID: %s", filepath.Base(spaceDir))

	// Ensure columns that may have been added later exist (safe no-op if already present)
	oldDB.Exec("ALTER TABLE pages ADD COLUMN is_starred BOOLEAN DEFAULT 0")
	oldDB.Exec("ALTER TABLE pages ADD COLUMN last_accessed_at DATETIME")

	// Read all old rows with integer IDs
	type oldPageRow struct {
		ID           int
		Title        string
		FilePath     string
		Icon         string
		CoverURL     string
		FullPage     bool
		SortOrder    float64
		IsStarred    bool
		LastAccessed *time.Time
	}

	rows, err := oldDB.Query(`SELECT id, title, file_path, icon, cover_url, full_page, sort_order, COALESCE(is_starred, 0), last_accessed_at FROM pages`)
	if err != nil {
		return fmt.Errorf("failed to read old pages: %w", err)
	}

	var oldPages []oldPageRow
	for rows.Next() {
		var p oldPageRow
		var icon, coverURL sql.NullString
		var lastAccessed sql.NullTime
		if err := rows.Scan(&p.ID, &p.Title, &p.FilePath, &icon, &coverURL, &p.FullPage, &p.SortOrder, &p.IsStarred, &lastAccessed); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan old page: %w", err)
		}
		if icon.Valid {
			p.Icon = icon.String
		}
		if coverURL.Valid {
			p.CoverURL = coverURL.String
		}
		if lastAccessed.Valid {
			p.LastAccessed = &lastAccessed.Time
		}
		oldPages = append(oldPages, p)
	}
	rows.Close()

	// Build mapping: oldIntID → newUUID
	// Also write UUIDs into .md frontmatters
	idMap := make(map[int]string)
	for _, p := range oldPages {
		absPath := filepath.Join(s.docsDir, p.FilePath)
		raw, err := os.ReadFile(absPath)
		if err != nil {
			// File may have been deleted; generate UUID anyway
			idMap[p.ID] = uuidutil.NewPageID()
			continue
		}

		fm, body, _ := frontmatter.Parse(raw)
		if fm.ID != "" {
			// Already has UUID (maybe manually set or partial migration)
			idMap[p.ID] = fm.ID
		} else {
			newID := uuidutil.NewPageID()
			fm.ID = newID
			assembled := frontmatter.Render(fm, body)
			os.WriteFile(absPath, assembled, 0644)
			idMap[p.ID] = newID
		}
	}

	// Rewrite subpage comments in all .md files within the space
	filepath.WalkDir(spaceDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".md") {
			return nil
		}
		// Skip .trash directory
		if strings.Contains(path, string(filepath.Separator)+".trash") {
			return nil
		}

		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		fm, body, _ := frontmatter.Parse(raw)

		changed := false
		newBody := oldSubpageRe.ReplaceAllStringFunc(body, func(match string) string {
			subMatch := oldSubpageRe.FindStringSubmatch(match)
			if len(subMatch) == 2 {
				var oldID int
				if _, err := fmt.Sscanf(subMatch[1], "%d", &oldID); err == nil {
					if newUUID, ok := idMap[oldID]; ok {
						changed = true
						return formatSubpageTag(newUUID)
					}
				}
			}
			return match
		})

		if changed {
			assembled := frontmatter.Render(fm, newBody)
			os.WriteFile(path, assembled, 0644)
		}
		return nil
	})

	// Close old DB before replacing it
	oldDB.Close()

	// Delete old .cache.db
	if err := os.Remove(cachePath); err != nil {
		return fmt.Errorf("failed to remove old cache db: %w", err)
	}

	// Create new .cache.db with TEXT primary key schema
	newDB, err := repository.OpenSpaceDB(spaceDir)
	if err != nil {
		return fmt.Errorf("failed to create new cache db: %w", err)
	}
	repo := repository.NewPageRepository(newDB)

	for _, p := range oldPages {
		newID, ok := idMap[p.ID]
		if !ok {
			newID = uuidutil.NewPageID()
		}
		page := &model.Page{
			ID:        newID,
			Title:     p.Title,
			FilePath:  p.FilePath,
			Icon:      p.Icon,
			CoverURL:  p.CoverURL,
			FullPage:  p.FullPage,
			SortOrder: p.SortOrder,
			IsStarred: p.IsStarred,
		}
		if _, err := repo.Create(page); err != nil {
			log.Printf("Warning: failed to create page %s in new cache: %v", p.FilePath, err)
		}
	}

	newDB.Close()

	// Write migration marker
	os.WriteFile(markerPath, []byte("migrated"), 0644)
	log.Printf("Space migration complete: %s (%d pages)", filepath.Base(spaceDir), len(oldPages))
	return nil
}

// checkCacheNeedsMigration checks if the pages table uses INTEGER primary key.
func (s *PageService) checkCacheNeedsMigration(db *sql.DB) (bool, error) {
	rows, err := db.Query("PRAGMA table_info(pages)")
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return false, err
		}
		if name == "id" && strings.Contains(strings.ToUpper(colType), "INTEGER") {
			return true, nil
		}
	}
	return false, nil
}
