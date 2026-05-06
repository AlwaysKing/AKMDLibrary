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
		// Skip non-directories and hidden files
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		// Skip public directory
		if entry.Name() == "public" {
			continue
		}

		// Create space from directory
		spaces = append(spaces, &model.Space{
			Name: entry.Name(),
			Slug: generateSlug(entry.Name()),
		})
	}

	return spaces, nil
}

func (s *Scanner) ScanPageTree(spaceSlug string) ([]*model.PageNode, error) {
	spacePath := filepath.Join(s.docsDir, spaceSlug)
	if _, err := os.Stat(spacePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("space not found: %s", spaceSlug)
	}

	entries, err := os.ReadDir(spacePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read space directory: %w", err)
	}

	var nodes []*model.PageNode
	for _, entry := range entries {
		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		// Skip public directory
		if entry.Name() == "public" {
			continue
		}

		// If it's a .md file at root level
		if strings.HasSuffix(entry.Name(), ".md") {
			title := strings.TrimSuffix(entry.Name(), ".md")
			nodes = append(nodes, &model.PageNode{
				ID:        generateID(title),
				Title:     title,
				Icon:      "",
				SortOrder: 0,
				FilePath:  spaceSlug + "/" + entry.Name(),
				Children:  nil,
			})
			continue
		}

		// If it's a directory
		if entry.IsDir() {
			// Check if the directory contains a same-name .md file (e.g., Getting Started/Getting Started.md)
			internalMD := filepath.Join(spacePath, entry.Name(), entry.Name()+".md")
			hasInternalMD := false
			if _, err := os.Stat(internalMD); err == nil {
				hasInternalMD = true
			}

			// Check for sibling .md file at root level (e.g., Getting Started.md alongside Getting Started/)
			siblingMD := filepath.Join(spacePath, entry.Name()+".md")
			hasSiblingMD := false
			if _, err := os.Stat(siblingMD); err == nil {
				hasSiblingMD = true
			}

			// Determine file path for this page
			var pageFilePath string
			if hasInternalMD {
				// Directory contains same-name .md: path is spaceSlug/DirName/DirName.md
				pageFilePath = spaceSlug + "/" + entry.Name() + "/" + entry.Name() + ".md"
			} else if hasSiblingMD {
				// Sibling .md file: path is spaceSlug/DirName.md
				pageFilePath = spaceSlug + "/" + entry.Name() + ".md"
			}

			// Scan for children, skipping the same-name .md file
			children := s.scanDirectorySkipSelf(filepath.Join(spacePath, entry.Name()), entry.Name(), spaceSlug+"/"+entry.Name())

			nodes = append(nodes, &model.PageNode{
				ID:        generateID(entry.Name()),
				Title:     entry.Name(),
				Icon:      "",
				SortOrder: 0,
				FilePath:  pageFilePath,
				Children:  children,
			})
		}
	}

	// Sort by title
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes, nil
}

// scanDirectorySkipSelf scans a directory for child pages, skipping the .md file
// that matches the parent directory name (since it represents the parent page itself).
// parentName is the name of the parent directory (e.g., "Getting Started").
// pathPrefix is the relative path prefix for building FilePath (e.g., "spaceSlug/Getting Started").
func (s *Scanner) scanDirectorySkipSelf(dirPath string, parentName string, pathPrefix string) []*model.PageNode {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil
	}

	var nodes []*model.PageNode
	for _, entry := range entries {
		// Skip hidden files and public directory
		if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "public" {
			continue
		}

		// Skip the .md file that matches the parent directory name
		// (it represents the parent page content, not a child)
		if entry.Name() == parentName+".md" {
			continue
		}

		// If it's a .md file
		if strings.HasSuffix(entry.Name(), ".md") {
			title := strings.TrimSuffix(entry.Name(), ".md")
			nodes = append(nodes, &model.PageNode{
				ID:        generateID(title),
				Title:     title,
				Icon:      "",
				SortOrder: 0,
				FilePath:  pathPrefix + "/" + entry.Name(),
				Children:  nil,
			})
			continue
		}

		// If it's a directory
		if entry.IsDir() {
			// Check for internal same-name .md
			internalMD := filepath.Join(dirPath, entry.Name(), entry.Name()+".md")
			hasInternalMD := false
			if _, err := os.Stat(internalMD); err == nil {
				hasInternalMD = true
			}

			// Check for sibling .md
			siblingMD := filepath.Join(dirPath, entry.Name()+".md")
			hasSiblingMD := false
			if _, err := os.Stat(siblingMD); err == nil {
				hasSiblingMD = true
			}

			var pageFilePath string
			if hasInternalMD {
				pageFilePath = pathPrefix + "/" + entry.Name() + "/" + entry.Name() + ".md"
			} else if hasSiblingMD {
				pageFilePath = pathPrefix + "/" + entry.Name() + ".md"
			}

			children := s.scanDirectorySkipSelf(filepath.Join(dirPath, entry.Name()), entry.Name(), pathPrefix+"/"+entry.Name())

			nodes = append(nodes, &model.PageNode{
				ID:        generateID(entry.Name()),
				Title:     entry.Name(),
				Icon:      "",
				SortOrder: 0,
				FilePath:  pageFilePath,
				Children:  children,
			})
		}
	}

	// Sort by title
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Title < nodes[j].Title
	})

	return nodes
}

func generateSlug(name string) string {
	// Simple slug generation
	slug := strings.ToLower(name)
	slug = strings.ReplaceAll(slug, " ", "-")
	slug = strings.ReplaceAll(slug, "_", "-")

	// Remove special characters (keep only alphanumeric and hyphens)
	var result strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		}
	}

	slug = result.String()

	// Remove consecutive hyphens
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}

	// Trim hyphens
	slug = strings.Trim(slug, "-")

	if slug == "" {
		slug = "untitled"
	}

	return slug
}

func generateID(title string) int {
	// Simple hash-based ID generation
	// In production, this should come from the database
	hash := 0
	for _, r := range title {
		hash = hash*31 + int(r)
	}
	if hash < 0 {
		hash = -hash
	}
	return hash % 1000000 // Keep it reasonable
}
