package service

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/pkg/filesystem"
	"github.com/alwaysking/akmdlibrary/pkg/frontmatter"
)

var personalTodoLinePattern = regexp.MustCompile(`^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$`)

type PersonalService struct {
	userRepo    *repository.UserRepository
	spaceRepo   *repository.SpaceRepository
	memberRepo  *repository.MemberRepository
	pageService *PageService
	docsDir     string
	workspaceMu sync.Mutex
}

type personalWorkspace struct {
	space *model.Space
	slug  string
	path  string
}

func NewPersonalService(
	userRepo *repository.UserRepository,
	spaceRepo *repository.SpaceRepository,
	memberRepo *repository.MemberRepository,
	pageService *PageService,
	docsDir string,
) *PersonalService {
	return &PersonalService{
		userRepo:    userRepo,
		spaceRepo:   spaceRepo,
		memberRepo:  memberRepo,
		pageService: pageService,
		docsDir:     docsDir,
	}
}

func (s *PersonalService) Overview(userID int) (*model.PersonalOverview, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	todos, err := s.readTodos(workspace)
	if err != nil {
		return nil, err
	}
	notes, err := s.pageService.GetTree(workspace.slug)
	if err != nil {
		return nil, err
	}
	s.pageService.EnrichTreeWithDB(workspace.slug, notes)
	relDir, _ := filesystem.PersonalWorkspaceRelDir(workspace.slug)
	notes = filterReservedPersonalNotes(notes, relDir)
	return &model.PersonalOverview{
		SpaceSlug: workspace.slug,
		Todos:     todos,
		Notes:     notes,
	}, nil
}

func (s *PersonalService) CreateTodo(userID int, text string) ([]model.PersonalTodo, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	text = normalizeTodoText(text)
	if text == "" {
		return nil, fmt.Errorf("todo text is required")
	}
	if err := s.mutateTodos(workspace, func(lines []string) ([]string, error) {
		return append(lines, "- [ ] "+text), nil
	}); err != nil {
		return nil, err
	}
	return s.readTodos(workspace)
}

func (s *PersonalService) UpdateTodo(userID int, index int, req *model.UpdatePersonalTodoRequest) ([]model.PersonalTodo, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	if req.Text != nil {
		text := normalizeTodoText(*req.Text)
		if text == "" {
			return nil, fmt.Errorf("todo text is required")
		}
		req.Text = &text
	}
	if err := s.mutateTodos(workspace, func(lines []string) ([]string, error) {
		seen := 0
		for lineIndex, line := range lines {
			match := personalTodoLinePattern.FindStringSubmatch(line)
			if match == nil {
				continue
			}
			if seen == index {
				text := match[4]
				done := match[2]
				if req.Text != nil {
					text = *req.Text
				}
				if req.Done != nil {
					if *req.Done {
						done = "x"
					} else {
						done = " "
					}
				}
				lines[lineIndex] = match[1] + done + match[3] + text
				return lines, nil
			}
			seen++
		}
		return nil, fmt.Errorf("todo not found")
	}); err != nil {
		return nil, err
	}
	return s.readTodos(workspace)
}

func (s *PersonalService) DeleteTodo(userID int, index int) ([]model.PersonalTodo, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	if err := s.mutateTodos(workspace, func(lines []string) ([]string, error) {
		seen := 0
		for lineIndex, line := range lines {
			if personalTodoLinePattern.MatchString(line) {
				if seen == index {
					return append(lines[:lineIndex], lines[lineIndex+1:]...), nil
				}
				seen++
			}
		}
		return nil, fmt.Errorf("todo not found")
	}); err != nil {
		return nil, err
	}
	return s.readTodos(workspace)
}

func (s *PersonalService) CreateNote(userID int, title string, parentID *string) (*model.Page, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "未命名笔记"
	}
	page, err := s.pageService.Create(workspace.slug, &model.CreatePageRequest{
		Title:    title,
		ParentID: parentID,
	}, workspace.space.ID)
	if err != nil {
		return nil, err
	}
	return page, nil
}

func (s *PersonalService) DeleteNote(userID int, pageID string) error {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return err
	}
	if _, err := s.pageService.GetByID(workspace.slug, pageID); err != nil {
		return err
	}
	return s.pageService.Delete(workspace.slug, pageID)
}

func (s *PersonalService) ensureWorkspace(userID int) (*personalWorkspace, error) {
	s.workspaceMu.Lock()
	defer s.workspaceMu.Unlock()

	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(user.UUID) == "" {
		return nil, fmt.Errorf("user uuid is missing")
	}

	slug := model.PersonalSpacePrefix + user.UUID
	workspacePath, ok := filesystem.PersonalWorkspacePath(s.docsDir, slug)
	if !ok {
		return nil, fmt.Errorf("invalid personal workspace path")
	}
	oldWorkspacePath := filepath.Join(s.docsDir, slug)
	migrated, err := migratePersonalWorkspace(oldWorkspacePath, workspacePath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(workspacePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create personal workspace: %w", err)
	}
	if err := migrateLegacyPersonalTodo(workspacePath); err != nil {
		return nil, err
	}
	if migrated {
		_ = os.Remove(filepath.Join(workspacePath, ".cache.db"))
	}

	space, err := s.spaceRepo.GetBySlug(slug)
	if err != nil {
		space, err = s.spaceRepo.Create(&model.CreateSpaceRequest{
			Name:        slug,
			Description: "Personal workspace",
		}, slug)
		if err != nil {
			return nil, fmt.Errorf("failed to create personal space: %w", err)
		}
	}

	member, err := s.memberRepo.GetBySpaceAndUser(space.ID, userID)
	if err != nil {
		return nil, err
	}
	if member == nil {
		if _, err := s.memberRepo.Add(space.ID, userID, "admin"); err != nil {
			return nil, fmt.Errorf("failed to add personal workspace owner: %w", err)
		}
	}

	todosPath := filepath.Join(workspacePath, "todos.md")
	if _, err := os.Stat(todosPath); os.IsNotExist(err) {
		fm := frontmatter.FrontmatterData{Type: "personal_todos"}
		if err := os.WriteFile(todosPath, frontmatter.Render(fm, ""), 0644); err != nil {
			return nil, fmt.Errorf("failed to initialize personal todos: %w", err)
		}
	}

	cachePath := filepath.Join(workspacePath, ".cache.db")
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		if err := s.pageService.RebuildCache(slug); err != nil {
			return nil, fmt.Errorf("failed to initialize personal page cache: %w", err)
		}
	}

	return &personalWorkspace{space: space, slug: slug, path: workspacePath}, nil
}

func (s *PersonalService) readTodos(workspace *personalWorkspace) ([]model.PersonalTodo, error) {
	todosPath := filepath.Join(workspace.path, "todos.md")
	raw, err := os.ReadFile(todosPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read personal todos: %w", err)
	}
	_, body, _ := frontmatter.Parse(raw)
	lines := strings.Split(strings.TrimSuffix(body, "\n"), "\n")
	todos := make([]model.PersonalTodo, 0)
	for _, line := range lines {
		match := personalTodoLinePattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		todos = append(todos, model.PersonalTodo{
			Index: len(todos),
			Text:  match[4],
			Done:  strings.EqualFold(match[2], "x"),
		})
	}
	return todos, nil
}

func (s *PersonalService) mutateTodos(workspace *personalWorkspace, mutate func([]string) ([]string, error)) error {
	todosPath := filepath.Join(workspace.path, "todos.md")
	raw, err := os.ReadFile(todosPath)
	if err != nil {
		return fmt.Errorf("failed to read personal todos: %w", err)
	}
	fm, body, _ := frontmatter.Parse(raw)
	body = strings.TrimSuffix(body, "\n")
	lines := []string{}
	if body != "" {
		lines = strings.Split(body, "\n")
	}
	lines, err = mutate(lines)
	if err != nil {
		return err
	}
	nextBody := strings.Join(lines, "\n")
	if nextBody != "" {
		nextBody += "\n"
	}
	if err := os.WriteFile(todosPath, frontmatter.Render(fm, nextBody), 0644); err != nil {
		return fmt.Errorf("failed to write personal todos: %w", err)
	}
	return nil
}

func normalizeTodoText(text string) string {
	text = strings.ReplaceAll(text, "\r", " ")
	text = strings.ReplaceAll(text, "\n", " ")
	return strings.TrimSpace(text)
}

func filterReservedPersonalNotes(notes []*model.PageNode, relDir string) []*model.PageNode {
	todoPath := filepath.Join(relDir, "todos.md")
	filtered := make([]*model.PageNode, 0, len(notes))
	for _, note := range notes {
		if note.FilePath == todoPath {
			continue
		}
		filtered = append(filtered, note)
	}
	return filtered
}

func migratePersonalWorkspace(oldPath string, newPath string) (bool, error) {
	oldInfo, err := os.Stat(oldPath)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to inspect legacy personal workspace: %w", err)
	}
	if !oldInfo.IsDir() {
		return false, fmt.Errorf("legacy personal workspace path is not a directory")
	}

	newInfo, err := os.Stat(newPath)
	switch {
	case os.IsNotExist(err):
		if err := os.MkdirAll(filepath.Dir(newPath), 0755); err != nil {
			return false, fmt.Errorf("failed to create personal workspace parent: %w", err)
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return false, fmt.Errorf("failed to migrate personal workspace: %w", err)
		}
		return true, nil
	case err != nil:
		return false, fmt.Errorf("failed to inspect personal workspace: %w", err)
	case !newInfo.IsDir():
		return false, fmt.Errorf("personal workspace path is not a directory")
	}

	if err := moveMissingPersonalEntries(oldPath, newPath); err != nil {
		return false, err
	}
	return true, nil
}

func moveMissingPersonalEntries(oldPath string, newPath string) error {
	entries, err := os.ReadDir(oldPath)
	if err != nil {
		return fmt.Errorf("failed to read legacy personal workspace: %w", err)
	}
	for _, entry := range entries {
		source := filepath.Join(oldPath, entry.Name())
		destination := filepath.Join(newPath, entry.Name())
		destinationInfo, destinationErr := os.Stat(destination)
		if os.IsNotExist(destinationErr) {
			if err := os.Rename(source, destination); err != nil {
				return fmt.Errorf("failed to move legacy personal file %s: %w", entry.Name(), err)
			}
			continue
		}
		if destinationErr != nil {
			return fmt.Errorf("failed to inspect personal file %s: %w", entry.Name(), destinationErr)
		}
		if entry.IsDir() && destinationInfo.IsDir() {
			if err := moveMissingPersonalEntries(source, destination); err != nil {
				return err
			}
			continue
		}
		if entry.Name() == ".cache.db" {
			_ = os.Remove(source)
			continue
		}
		return fmt.Errorf("personal workspace migration conflict: %s", entry.Name())
	}
	if remaining, err := os.ReadDir(oldPath); err == nil && len(remaining) == 0 {
		_ = os.Remove(oldPath)
	}
	return nil
}

func migrateLegacyPersonalTodo(workspacePath string) error {
	legacyDir := filepath.Join(workspacePath, ".personal")
	legacyTodo := filepath.Join(legacyDir, "todos.md")
	currentTodo := filepath.Join(workspacePath, "todos.md")
	if _, err := os.Stat(legacyTodo); err == nil {
		if _, currentErr := os.Stat(currentTodo); os.IsNotExist(currentErr) {
			if err := os.Rename(legacyTodo, currentTodo); err != nil {
				return fmt.Errorf("failed to migrate personal todos: %w", err)
			}
		}
	}
	if entries, err := os.ReadDir(legacyDir); err == nil && len(entries) == 0 {
		_ = os.Remove(legacyDir)
	}
	return nil
}
