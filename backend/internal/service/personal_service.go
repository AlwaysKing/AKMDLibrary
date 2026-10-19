package service

import (
	"encoding/xml"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/pkg/filesystem"
	"github.com/alwaysking/akmdlibrary/pkg/frontmatter"
	"github.com/alwaysking/akmdlibrary/pkg/uuidutil"
)

var personalTodoLinePattern = regexp.MustCompile(`^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$`)

type PersonalService struct {
	userRepo    *repository.UserRepository
	spaceRepo   *repository.SpaceRepository
	memberRepo  *repository.MemberRepository
	pageService *PageService
	databaseSvc *DatabaseService
	docsDir     string
	workspaceMu sync.Mutex
	todoMu      sync.Mutex
}

type personalWorkspace struct {
	space *model.Space
	slug  string
	path  string
}

type personalTodoXML struct {
	ID          string               `xml:"id,attr"`
	Done        string               `xml:"done,attr"`
	CreatedAt   string               `xml:"created-at,attr,omitempty"`
	TodayOn     string               `xml:"today-on,attr,omitempty"`
	TodaySetAt  string               `xml:"today-set-at,attr,omitempty"`
	CompletedAt string               `xml:"completed-at,attr,omitempty"`
	Text        string               `xml:"text"`
	Link        *personalTodoLinkXML `xml:"link,omitempty"`
}

type personalTodoLinkXML struct {
	Type       string `xml:"type,attr"`
	SpaceSlug  string `xml:"space-slug,attr"`
	PageID     string `xml:"page-id,attr,omitempty"`
	DatabaseID string `xml:"database-id,attr,omitempty"`
	RowID      string `xml:"row-id,attr,omitempty"`
}

type personalTodoDocumentXML struct {
	XMLName xml.Name          `xml:"personal-todos"`
	Todos   []personalTodoXML `xml:"todo-item"`
}

func NewPersonalService(
	userRepo *repository.UserRepository,
	spaceRepo *repository.SpaceRepository,
	memberRepo *repository.MemberRepository,
	pageService *PageService,
	databaseService *DatabaseService,
	docsDir string,
) *PersonalService {
	return &PersonalService{
		userRepo:    userRepo,
		spaceRepo:   spaceRepo,
		memberRepo:  memberRepo,
		pageService: pageService,
		databaseSvc: databaseService,
		docsDir:     docsDir,
	}
}

func (s *PersonalService) Overview(userID int) (*model.PersonalOverview, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	s.todoMu.Lock()
	todos, err := s.readTodos(workspace)
	s.todoMu.Unlock()
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
		Recent:    s.recentNotes(workspace.slug, notes),
	}, nil
}

// recentNotes 按最近访问时间平铺返回个人笔记。缓存行可能因外部删除/移动指向旧路径，
// 所以只保留当前文件树里还在的页面；树是扫盘得来的，以它为准。
func (s *PersonalService) recentNotes(spaceSlug string, notes []*model.PageNode) []*model.PageNode {
	const limit = 5

	nodeByPath := make(map[string]*model.PageNode)
	var collect func(nodes []*model.PageNode)
	collect = func(nodes []*model.PageNode) {
		for _, note := range nodes {
			nodeByPath[note.FilePath] = note
			collect(note.Children)
		}
	}
	collect(notes)

	pages, err := s.pageService.ListRecent(spaceSlug, 50)
	if err != nil {
		return []*model.PageNode{}
	}
	recent := make([]*model.PageNode, 0, limit)
	for _, page := range pages {
		node, ok := nodeByPath[page.FilePath]
		if !ok {
			continue
		}
		// 平铺列表不需要子树，浅拷贝一份免得带出整棵后代
		flat := *node
		flat.Children = nil
		recent = append(recent, &flat)
		if len(recent) == limit {
			break
		}
	}
	return recent
}

func (s *PersonalService) CreateTodo(userID int, req *model.CreatePersonalTodoRequest) (*model.CreatePersonalTodoResponse, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	text := normalizeTodoText(req.Text)
	if req.Link != nil {
		normalizedLink, resolvedText, err := s.resolveTodoLink(userID, workspace, req.Link)
		if err != nil {
			return nil, err
		}
		req.Link = normalizedLink
		text = resolvedText
	}
	if text == "" {
		return nil, fmt.Errorf("todo text is required")
	}

	s.todoMu.Lock()
	defer s.todoMu.Unlock()
	records, err := s.loadTodoRecords(workspace)
	if err != nil {
		return nil, err
	}
	if req.Link != nil {
		linkKey := todoLinkKey(req.Link)
		for i := range records {
			if todoLinkKey(todoLinkFromXML(records[i].Link)) == linkKey {
				if req.Today {
					now := time.Now()
					records[i].TodayOn = now.Format("2006-01-02")
					records[i].TodaySetAt = now.Format(time.RFC3339)
					if err := s.writeTodoRecords(workspace, records); err != nil {
						return nil, err
					}
				}
				todos := todosFromRecords(records)
				existing := findTodoByLink(todos, req.Link)
				return &model.CreatePersonalTodoResponse{Todo: existing, Todos: todos, Created: false}, nil
			}
		}
	}

	now := time.Now()
	record := personalTodoXML{
		ID:        uuidutil.NewPageID(),
		Done:      "0",
		CreatedAt: now.Format(time.RFC3339),
		Text:      text,
		Link:      todoLinkToXML(req.Link),
	}
	if req.Today {
		record.TodayOn = now.Format("2006-01-02")
		record.TodaySetAt = now.Format(time.RFC3339)
	}
	records = append(records, record)
	if err := s.writeTodoRecords(workspace, records); err != nil {
		return nil, err
	}
	todos := todosFromRecords(records)
	return &model.CreatePersonalTodoResponse{
		Todo:    todoFromXML(record, now),
		Todos:   todos,
		Created: true,
	}, nil
}

func (s *PersonalService) UpdateTodo(userID int, todoID string, req *model.UpdatePersonalTodoRequest) ([]model.PersonalTodo, error) {
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
	s.todoMu.Lock()
	defer s.todoMu.Unlock()
	records, err := s.loadTodoRecords(workspace)
	if err != nil {
		return nil, err
	}
	found := false
	now := time.Now()
	for i := range records {
		if records[i].ID != todoID {
			continue
		}
		found = true
		if req.Text != nil {
			records[i].Text = *req.Text
		}
		if req.Done != nil {
			if *req.Done {
				records[i].Done = "1"
				if records[i].CompletedAt == "" {
					records[i].CompletedAt = now.Format(time.RFC3339)
				}
			} else {
				records[i].Done = "0"
				records[i].CompletedAt = ""
			}
		}
		if req.Today != nil {
			if *req.Today {
				records[i].TodayOn = now.Format("2006-01-02")
				records[i].TodaySetAt = now.Format(time.RFC3339)
			} else {
				records[i].TodayOn = ""
				records[i].TodaySetAt = ""
			}
		}
		break
	}
	if !found {
		return nil, fmt.Errorf("todo not found")
	}
	if err := s.writeTodoRecords(workspace, records); err != nil {
		return nil, err
	}
	return todosFromRecords(records), nil
}

func (s *PersonalService) DeleteTodo(userID int, todoID string) ([]model.PersonalTodo, error) {
	workspace, err := s.ensureWorkspace(userID)
	if err != nil {
		return nil, err
	}
	s.todoMu.Lock()
	defer s.todoMu.Unlock()
	records, err := s.loadTodoRecords(workspace)
	if err != nil {
		return nil, err
	}
	next := make([]personalTodoXML, 0, len(records))
	found := false
	for _, record := range records {
		if record.ID == todoID {
			found = true
			continue
		}
		next = append(next, record)
	}
	if !found {
		return nil, fmt.Errorf("todo not found")
	}
	if err := s.writeTodoRecords(workspace, next); err != nil {
		return nil, err
	}
	return todosFromRecords(next), nil
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
	records, err := s.loadTodoRecords(workspace)
	if err != nil {
		return nil, err
	}
	return todosFromRecords(records), nil
}

func (s *PersonalService) loadTodoRecords(workspace *personalWorkspace) ([]personalTodoXML, error) {
	todosPath := filepath.Join(workspace.path, "todos.md")
	raw, err := os.ReadFile(todosPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read personal todos: %w", err)
	}
	_, body, _ := frontmatter.Parse(raw)
	start := strings.Index(body, "<personal-todos>")
	end := strings.Index(body, "</personal-todos>")
	if start >= 0 && end >= start {
		block := body[start : end+len("</personal-todos>")]
		var document personalTodoDocumentXML
		if err := xml.Unmarshal([]byte(block), &document); err != nil {
			return nil, fmt.Errorf("failed to parse personal todos XML: %w", err)
		}
		return document.Todos, nil
	}

	records := legacyTodoRecords(body)
	if len(records) > 0 {
		if err := s.writeTodoRecords(workspace, records); err != nil {
			return nil, err
		}
	}
	return records, nil
}

func (s *PersonalService) writeTodoRecords(workspace *personalWorkspace, records []personalTodoXML) error {
	todosPath := filepath.Join(workspace.path, "todos.md")
	raw, err := os.ReadFile(todosPath)
	if err != nil {
		return fmt.Errorf("failed to read personal todos: %w", err)
	}
	fm, body, _ := frontmatter.Parse(raw)
	document := personalTodoDocumentXML{Todos: records}
	xmlBytes, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode personal todos XML: %w", err)
	}
	start := strings.Index(body, "<personal-todos>")
	end := strings.Index(body, "</personal-todos>")
	nextBody := body
	if start >= 0 && end >= start {
		nextBody = body[:start] + string(xmlBytes) + body[end+len("</personal-todos>"):]
	} else {
		nextBody = strings.TrimRight(body, "\n")
		if nextBody != "" {
			nextBody += "\n\n"
		}
		nextBody += string(xmlBytes) + "\n"
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

func legacyTodoRecords(body string) []personalTodoXML {
	now := time.Now().Format(time.RFC3339)
	records := make([]personalTodoXML, 0)
	for _, line := range strings.Split(body, "\n") {
		match := personalTodoLinePattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		done := "0"
		if strings.EqualFold(match[2], "x") {
			done = "1"
		}
		records = append(records, personalTodoXML{
			ID:        uuidutil.NewPageID(),
			Done:      done,
			CreatedAt: now,
			Text:      match[4],
		})
	}
	return records
}

func todosFromRecords(records []personalTodoXML) []model.PersonalTodo {
	now := time.Now()
	todos := make([]model.PersonalTodo, 0, len(records))
	for _, record := range records {
		todos = append(todos, todoFromXML(record, now))
	}
	sort.SliceStable(todos, func(i, j int) bool {
		if todos[i].Overdue != todos[j].Overdue {
			return todos[i].Overdue
		}
		if todos[i].IsToday != todos[j].IsToday {
			return todos[i].IsToday
		}
		if todos[i].TodaySetAt != todos[j].TodaySetAt {
			return todos[i].TodaySetAt < todos[j].TodaySetAt
		}
		return todos[i].CreatedAt < todos[j].CreatedAt
	})
	return todos
}

func todoFromXML(record personalTodoXML, now time.Time) model.PersonalTodo {
	today := now.Format("2006-01-02")
	return model.PersonalTodo{
		ID:          record.ID,
		Text:        record.Text,
		Done:        record.Done == "1",
		CreatedAt:   record.CreatedAt,
		TodayOn:     record.TodayOn,
		TodaySetAt:  record.TodaySetAt,
		CompletedAt: record.CompletedAt,
		IsToday:     record.TodayOn != "" && record.TodayOn == today,
		Overdue:     record.Done != "1" && record.TodayOn != "" && record.TodayOn < today,
		Link:        todoLinkFromXML(record.Link),
	}
}

func todoLinkFromXML(link *personalTodoLinkXML) *model.PersonalTodoLink {
	if link == nil {
		return nil
	}
	return &model.PersonalTodoLink{
		Type:       link.Type,
		SpaceSlug:  link.SpaceSlug,
		PageID:     link.PageID,
		DatabaseID: link.DatabaseID,
		RowID:      link.RowID,
	}
}

func todoLinkToXML(link *model.PersonalTodoLink) *personalTodoLinkXML {
	if link == nil {
		return nil
	}
	return &personalTodoLinkXML{
		Type:       link.Type,
		SpaceSlug:  link.SpaceSlug,
		PageID:     link.PageID,
		DatabaseID: link.DatabaseID,
		RowID:      link.RowID,
	}
}

func todoLinkKey(link *model.PersonalTodoLink) string {
	if link == nil {
		return ""
	}
	return strings.Join([]string{link.Type, link.SpaceSlug, link.PageID, link.DatabaseID, link.RowID}, "\x00")
}

func findTodoByLink(todos []model.PersonalTodo, link *model.PersonalTodoLink) model.PersonalTodo {
	key := todoLinkKey(link)
	for _, todo := range todos {
		if todoLinkKey(todo.Link) == key {
			return todo
		}
	}
	return model.PersonalTodo{}
}

func (s *PersonalService) resolveTodoLink(userID int, workspace *personalWorkspace, link *model.PersonalTodoLink) (*model.PersonalTodoLink, string, error) {
	normalized := &model.PersonalTodoLink{
		Type:       strings.TrimSpace(link.Type),
		SpaceSlug:  strings.TrimSpace(link.SpaceSlug),
		PageID:     strings.TrimSpace(link.PageID),
		DatabaseID: strings.TrimSpace(link.DatabaseID),
		RowID:      strings.TrimSpace(link.RowID),
	}
	if normalized.SpaceSlug == "" {
		return nil, "", fmt.Errorf("todo link space is required")
	}
	if model.IsPersonalSpaceSlug(normalized.SpaceSlug) {
		if normalized.SpaceSlug != workspace.slug {
			return nil, "", fmt.Errorf("invalid personal todo link")
		}
	} else {
		space, err := s.spaceRepo.GetBySlug(normalized.SpaceSlug)
		if err != nil {
			return nil, "", fmt.Errorf("todo link space not found: %w", err)
		}
		member, err := s.memberRepo.GetBySpaceAndUser(space.ID, userID)
		if err != nil || member == nil {
			return nil, "", fmt.Errorf("todo link access denied")
		}
	}

	switch normalized.Type {
	case "page":
		if normalized.PageID == "" || normalized.DatabaseID != "" || normalized.RowID != "" {
			return nil, "", fmt.Errorf("invalid page todo link")
		}
		page, err := s.pageService.GetByID(normalized.SpaceSlug, normalized.PageID)
		if err != nil {
			return nil, "", fmt.Errorf("todo link page not found: %w", err)
		}
		return normalized, page.Title, nil
	case "database-row":
		if normalized.DatabaseID == "" || normalized.RowID == "" || normalized.PageID != "" {
			return nil, "", fmt.Errorf("invalid database todo link")
		}
		if s.databaseSvc == nil {
			return nil, "", fmt.Errorf("database service is unavailable")
		}
		detail, err := s.databaseSvc.Get(normalized.SpaceSlug, normalized.DatabaseID)
		if err != nil {
			return nil, "", fmt.Errorf("todo link database not found: %w", err)
		}
		row, err := s.databaseSvc.GetRow(normalized.SpaceSlug, normalized.DatabaseID, normalized.RowID)
		if err != nil {
			return nil, "", fmt.Errorf("todo link row not found: %w", err)
		}
		if title := strings.TrimSpace(row.Values["title"]); title != "" {
			return normalized, title, nil
		}
		for _, column := range detail.Columns {
			if column.Type == "text" && strings.TrimSpace(row.Values[column.ID]) != "" {
				return normalized, strings.TrimSpace(row.Values[column.ID]), nil
			}
		}
		return normalized, normalized.RowID, nil
	default:
		return nil, "", fmt.Errorf("unsupported todo link type")
	}
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
