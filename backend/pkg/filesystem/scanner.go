package filesystem

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/pkg/frontmatter"
	"github.com/alwaysking/akmdlibrary/pkg/uuidutil"
)

type Scanner struct {
	docsDir string
}

func NewScanner(docsDir string) *Scanner {
	return &Scanner{docsDir: docsDir}
}

func (s *Scanner) ScanSpaces() ([]*model.Space, error) {
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read docs directory: %w", err)
	}

	var spaces []*model.Space
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.Name() == "public" {
			continue
		}
		spaces = append(spaces, &model.Space{
			Name: entry.Name(),
			Slug: generateSlug(entry.Name()),
		})
	}

	return spaces, nil
}

func (s *Scanner) ScanPageTree(spaceSlug string) ([]*model.PageNode, error) {
	spacePath, dirName := s.resolveSpaceDir(spaceSlug)
	if spacePath == "" {
		return nil, fmt.Errorf("space not found: %s", spaceSlug)
	}

	nodes, err := s.scanDirectory(spacePath, dirName)
	if err != nil {
		return nil, err
	}

	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes, nil
}

// resolveSpaceDir finds the actual directory for a space slug.
func (s *Scanner) resolveSpaceDir(spaceSlug string) (string, string) {
	exactPath := filepath.Join(s.docsDir, spaceSlug)
	if info, err := os.Stat(exactPath); err == nil && info.IsDir() {
		return exactPath, spaceSlug
	}

	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return "", ""
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || entry.Name() == "public" {
			continue
		}
		if generateSlug(entry.Name()) == spaceSlug {
			return filepath.Join(s.docsDir, entry.Name()), entry.Name()
		}
	}
	return "", ""
}

// scanDirectory scans a directory for pages.
func (s *Scanner) scanDirectory(dirPath string, pathPrefix string) ([]*model.PageNode, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	// Build a set of directory names for quick lookup
	dirSet := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") && entry.Name() != "public" {
			dirSet[entry.Name()] = true
		}
	}

	nodes := make([]*model.PageNode, 0)

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "public" {
			continue
		}

		// Only process .md files as pages
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".md") {
			title := strings.TrimSuffix(entry.Name(), ".md")
			relPath := pathPrefix + "/" + entry.Name()
			nodeID := readOrCreatePageID(filepath.Join(dirPath, entry.Name()))

			node := &model.PageNode{
				ID:        nodeID,
				Title:     title,
				Icon:      "",
				SortOrder: 0,
				FilePath:  relPath,
				Children:  nil,
			}

			// Check if there's a matching directory for children
			if dirSet[title] {
				childDir := filepath.Join(dirPath, title)
				childPrefix := pathPrefix + "/" + title
				children, err := s.scanDirectory(childDir, childPrefix)
				if err == nil && len(children) > 0 {
					node.Children = children
				}
			}

			nodes = append(nodes, node)
		}
	}

	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes, nil
}

func generateSlug(name string) string {
	return name
}

// readOrCreatePageID reads the frontmatter from a .md file to get its ID.
// If no ID exists in frontmatter, generates a new UUID (but does NOT write it —
// writing is done later by ensurePageUUID in page_service.go during DB enrichment).
func readOrCreatePageID(absPath string) string {
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return uuidutil.NewPageID()
	}

	fm, _, _ := frontmatter.Parse(raw)
	if fm.ID != "" {
		return fm.ID
	}

	return uuidutil.NewPageID()
}
