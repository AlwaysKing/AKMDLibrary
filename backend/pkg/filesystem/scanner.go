package filesystem

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alwaysking/mdlibrary/internal/model"
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

	// Use actual directory name as pathPrefix so FilePath stores the real path
	nodes, err := s.scanDirectory(spacePath, dirName)
	if err != nil {
		return nil, err
	}

	// Sort by title
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes, nil
}

// resolveSpaceDir finds the actual directory for a space slug.
// Returns the full path and the directory name.
func (s *Scanner) resolveSpaceDir(spaceSlug string) (string, string) {
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
// Each .md file is a page. If a directory with the same name as the .md file exists,
// it contains the page's children.
// pathPrefix is the relative path prefix (e.g. "space" or "space/parent").
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
			node := &model.PageNode{
				ID:        generateID(title),
				Title:     title,
				Icon:      "",
				SortOrder: 0,
				FilePath:  pathPrefix + "/" + entry.Name(),
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

	// Sort by title
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes, nil
}

func generateSlug(name string) string {
	slug := strings.ToLower(name)
	slug = strings.ReplaceAll(slug, " ", "-")
	slug = strings.ReplaceAll(slug, "_", "-")

	var result strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		}
	}

	slug = result.String()
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	slug = strings.Trim(slug, "-")

	if slug == "" {
		slug = "untitled"
	}

	return slug
}

func generateID(title string) int {
	hash := 0
	for _, r := range title {
		hash = hash*31 + int(r)
	}
	if hash < 0 {
		hash = -hash
	}
	return hash % 1000000
}
