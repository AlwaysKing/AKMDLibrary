package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/pkg/databasecsv"
	"github.com/alwaysking/akmdlibrary/pkg/frontmatter"
	"github.com/google/uuid"
)

var validDatabaseColumnTypes = map[string]bool{
	"text": true, "number": true, "select": true, "multi_select": true, "date": true,
	"checkbox": true, "url": true, "status": true, "formula": true, "relation": true,
	"created_time": true, "last_edited_time": true, "last_edited_user": true, "linked": true,
}

type DatabaseService struct {
	docsDir string
	dbLocks sync.Map
	gitSync *GitSyncWorker
}

func NewDatabaseService(docsDir string) *DatabaseService {
	return &DatabaseService{docsDir: docsDir}
}

func (s *DatabaseService) SetGitSyncWorker(w *GitSyncWorker) { s.gitSync = w }

func (s *DatabaseService) markGitDirty(spaceSlug string) {
	if s.gitSync != nil && spaceSlug != "" {
		s.gitSync.MarkDirty(spaceSlug)
	}
}

func (s *DatabaseService) lockKey(spaceSlug, dirName string) string { return spaceSlug + "/" + dirName }

func (s *DatabaseService) lockDBs(keys []string) func() {
	sort.Strings(keys)
	unlocks := make([]func(), 0, len(keys))
	last := ""
	for _, key := range keys {
		if key == "" || key == last {
			continue
		}
		last = key
		v, _ := s.dbLocks.LoadOrStore(key, &sync.Mutex{})
		mu := v.(*sync.Mutex)
		mu.Lock()
		unlocks = append(unlocks, mu.Unlock)
	}
	return func() {
		for i := len(unlocks) - 1; i >= 0; i-- {
			unlocks[i]()
		}
	}
}

func (s *DatabaseService) resolveSpaceDir(spaceSlug string) (string, string, error) {
	exact := filepath.Join(s.docsDir, spaceSlug)
	if info, err := os.Stat(exact); err == nil && info.IsDir() {
		return exact, spaceSlug, nil
	}
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return "", "", err
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if e.Name() == spaceSlug {
			return filepath.Join(s.docsDir, e.Name()), e.Name(), nil
		}
	}
	return "", "", fmt.Errorf("space directory not found: %s", spaceSlug)
}

func (s *DatabaseService) databaseRoot(spaceSlug string) (string, error) {
	spaceDir, _, err := s.resolveSpaceDir(spaceSlug)
	if err != nil {
		return "", err
	}
	return filepath.Join(spaceDir, "_database"), nil
}

func validateDBName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("database name is required")
	}
	if strings.HasPrefix(name, ".") {
		return errors.New("database name cannot start with dot")
	}
	if strings.ContainsAny(name, `/\:*?"<>|`) {
		return errors.New("database name contains reserved characters")
	}
	return nil
}

func defaultColumns() []model.DatabaseColumn {
	return []model.DatabaseColumn{
		{ID: "title", Name: "名称", Type: "text", Config: map[string]any{}, Default: ""},
		{ID: "created_time", Name: "创建时间", Type: "created_time", Readonly: true, Auto: true, Config: map[string]any{"include_time": true}},
		{ID: "last_edited_time", Name: "修改时间", Type: "last_edited_time", Readonly: true, Auto: true, Config: map[string]any{"include_time": true}},
		{ID: "last_edited_user", Name: "修改人", Type: "last_edited_user", Readonly: true, Auto: true, Config: map[string]any{}},
	}
}

func (s *DatabaseService) List(spaceSlug string) ([]model.DatabaseSummary, error) {
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	out := []model.DatabaseSummary{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		cfg, err := s.readConfigByDir(root, e.Name())
		if err != nil {
			continue
		}
		table, _ := databasecsv.Read(filepath.Join(root, e.Name(), "data.csv"))
		out = append(out, summaryFromConfig(*cfg, e.Name(), len(table.Rows)))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (s *DatabaseService) Create(spaceSlug string, req model.CreateDatabaseRequest) (*model.DatabaseDetail, error) {
	if err := validateDBName(req.Name); err != nil {
		return nil, err
	}
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return nil, err
	}
	dir := strings.TrimSpace(req.Name)
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	dbDir := filepath.Join(root, dir)
	if _, err := os.Stat(dbDir); err == nil {
		return nil, fmt.Errorf("database already exists")
	}
	if err := os.MkdirAll(filepath.Join(dbDir, "subpages"), 0755); err != nil {
		return nil, err
	}
	cfg := model.DatabaseConfig{
		ID:          uuid.NewString(),
		Name:        dir,
		Icon:        req.Icon,
		Description: req.Description,
		CreatedAt:   time.Now().UTC(),
		Columns:     defaultColumns(),
	}
	if err := s.writeConfig(dbDir, &cfg); err != nil {
		return nil, err
	}
	if err := databasecsv.Write(filepath.Join(dbDir, "data.csv"), headerForConfig(&cfg), nil); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	d := detailFromConfig(cfg, dir, 0)
	return &d, nil
}

func (s *DatabaseService) Get(spaceSlug, dbID string) (*model.DatabaseDetail, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	table, _ := databasecsv.Read(filepath.Join(root, dir, "data.csv"))
	d := detailFromConfig(*cfg, dir, len(table.Rows))
	return &d, nil
}

func (s *DatabaseService) UpdateMeta(spaceSlug, dbID string, req model.UpdateDatabaseRequest) (*model.DatabaseDetail, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	if req.Name != nil {
		cfg.Name = strings.TrimSpace(*req.Name)
	}
	if req.Icon != nil {
		cfg.Icon = *req.Icon
	}
	if req.Description != nil {
		cfg.Description = *req.Description
	}
	if err := s.writeConfig(filepath.Join(root, dir), cfg); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return s.Get(spaceSlug, dbID)
}

func (s *DatabaseService) Delete(spaceSlug, dbID string) error {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return err
	}
	keys := []string{s.lockKey(spaceSlug, dir)}
	targets, _ := s.relationTargetDirs(spaceSlug, cfg)
	for _, target := range targets {
		keys = append(keys, s.lockKey(spaceSlug, target))
	}
	unlock := s.lockDBs(keys)
	defer unlock()
	for _, target := range targets {
		_ = s.removeLinkedColumn(spaceSlug, target, cfg.ID)
	}
	if err := os.RemoveAll(filepath.Join(root, dir)); err != nil {
		return err
	}
	s.markGitDirty(spaceSlug)
	return nil
}

func (s *DatabaseService) AddColumn(spaceSlug, dbID string, req model.CreateDatabaseColumnRequest) (*model.DatabaseDetail, error) {
	if strings.TrimSpace(req.Name) == "" || !validDatabaseColumnTypes[req.Type] || req.Type == "linked" {
		return nil, errors.New("invalid column")
	}
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	keys := []string{s.lockKey(spaceSlug, dir)}
	targetDir := ""
	if req.Type == "relation" {
		if id, _ := req.Config["target_db_id"].(string); id != "" {
			_, targetDir, _, err = s.findDB(spaceSlug, id)
			if err != nil {
				return nil, err
			}
			keys = append(keys, s.lockKey(spaceSlug, targetDir))
		}
	}
	unlock := s.lockDBs(keys)
	defer unlock()
	col := model.DatabaseColumn{ID: uuid.NewString(), Name: strings.TrimSpace(req.Name), Type: req.Type, Icon: strings.TrimSpace(req.Icon), Default: req.Default, Description: req.Description, Config: req.Config}
	if col.Config == nil {
		col.Config = map[string]any{}
	}
	cfg.Columns = append(cfg.Columns, col)
	dbDir := filepath.Join(root, dir)
	if err := s.writeConfig(dbDir, cfg); err != nil {
		return nil, err
	}
	if err := s.rewriteRows(dbDir, cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			row[col.ID] = defaultCell(col)
		}
		return rows
	}); err != nil {
		return nil, err
	}
	if col.Type == "relation" && targetDir != "" {
		if err := s.ensureLinkedColumn(spaceSlug, targetDir, cfg, col); err != nil {
			return nil, err
		}
	}
	s.markGitDirty(spaceSlug)
	return s.Get(spaceSlug, dbID)
}

func (s *DatabaseService) UpdateColumn(spaceSlug, dbID, colID string, req model.UpdateDatabaseColumnRequest) (*model.DatabaseDetail, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	for i := range cfg.Columns {
		if cfg.Columns[i].ID == colID {
			if cfg.Columns[i].Readonly {
				return nil, errors.New("readonly column")
			}
			if req.Name != nil {
				cfg.Columns[i].Name = strings.TrimSpace(*req.Name)
			}
			if req.Type != nil && validDatabaseColumnTypes[*req.Type] && *req.Type != "linked" {
				cfg.Columns[i].Type = *req.Type
			}
			if req.Icon != nil {
				cfg.Columns[i].Icon = strings.TrimSpace(*req.Icon)
			}
			if req.Config != nil {
				cfg.Columns[i].Config = *req.Config
			}
			if req.Description != nil {
				cfg.Columns[i].Description = *req.Description
			}
			if req.Default != nil {
				cfg.Columns[i].Default = *req.Default
			}
			if err := s.writeConfig(filepath.Join(root, dir), cfg); err != nil {
				return nil, err
			}
			if err := s.rewriteRows(filepath.Join(root, dir), cfg, func(rows []map[string]string) []map[string]string {
				return rows
			}); err != nil {
				return nil, err
			}
			s.markGitDirty(spaceSlug)
			return s.Get(spaceSlug, dbID)
		}
	}
	return nil, errors.New("column not found")
}

func (s *DatabaseService) DeleteColumn(spaceSlug, dbID, colID string) (*model.DatabaseDetail, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	idx := -1
	for i, c := range cfg.Columns {
		if c.ID == colID {
			if c.Readonly {
				return nil, errors.New("readonly column")
			}
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, errors.New("column not found")
	}
	cfg.Columns = append(cfg.Columns[:idx], cfg.Columns[idx+1:]...)
	dbDir := filepath.Join(root, dir)
	if err := s.writeConfig(dbDir, cfg); err != nil {
		return nil, err
	}
	if err := s.rewriteRows(dbDir, cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			delete(row, colID)
		}
		return rows
	}); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return s.Get(spaceSlug, dbID)
}

func (s *DatabaseService) ReorderColumns(spaceSlug, dbID string, ids []string) (*model.DatabaseDetail, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	byID := map[string]model.DatabaseColumn{}
	for _, c := range cfg.Columns {
		byID[c.ID] = c
	}
	next := []model.DatabaseColumn{}
	seen := map[string]bool{}
	for _, id := range ids {
		if c, ok := byID[id]; ok {
			next = append(next, c)
			seen[id] = true
		}
	}
	for _, c := range cfg.Columns {
		if !seen[c.ID] {
			next = append(next, c)
		}
	}
	cfg.Columns = next
	if err := s.writeConfig(filepath.Join(root, dir), cfg); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return s.Get(spaceSlug, dbID)
}

func (s *DatabaseService) ListRows(spaceSlug, dbID string, limit, offset int) (*model.DatabaseRowsResponse, error) {
	root, dir, _, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	table, err := databasecsv.Read(filepath.Join(root, dir, "data.csv"))
	if err != nil {
		return nil, err
	}
	total := len(table.Rows)
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > total {
		limit = total
	}
	end := offset + limit
	if offset > total {
		offset, end = total, total
	} else if end > total {
		end = total
	}
	rows := make([]model.DatabaseRow, 0, end-offset)
	for _, r := range table.Rows[offset:end] {
		u := r["uuid"]
		vals := map[string]string{}
		for k, v := range r {
			if k != "uuid" {
				vals[k] = v
			}
		}
		rows = append(rows, model.DatabaseRow{UUID: u, Values: vals})
	}
	return &model.DatabaseRowsResponse{Rows: rows, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *DatabaseService) CreateRow(spaceSlug, dbID, username string, values map[string]string) (*model.DatabaseRow, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	rowID := uuid.NewString()
	now := unixTimestampString(time.Now().UTC())
	var created model.DatabaseRow
	err = s.rewriteRows(filepath.Join(root, dir), cfg, func(rows []map[string]string) []map[string]string {
		row := map[string]string{"uuid": rowID}
		for _, c := range cfg.Columns {
			row[c.ID] = defaultCell(c)
			if values != nil && !c.Readonly {
				if v, ok := values[c.ID]; ok {
					row[c.ID] = v
				}
			}
			if c.Type == "created_time" || c.Type == "last_edited_time" {
				row[c.ID] = now
			}
			if c.Type == "last_edited_user" {
				row[c.ID] = username
			}
			if c.Type == "linked" && row[c.ID] == "" {
				row[c.ID] = "[]"
			}
		}
		rows = append(rows, row)
		vals := map[string]string{}
		for k, v := range row {
			if k != "uuid" {
				vals[k] = v
			}
		}
		created = model.DatabaseRow{UUID: rowID, Values: vals}
		return rows
	})
	if err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return &created, nil
}

func (s *DatabaseService) ReorderRows(spaceSlug, dbID string, rowIDs []string) (*model.DatabaseRowsResponse, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	dbDir := filepath.Join(root, dir)
	table, err := databasecsv.Read(filepath.Join(dbDir, "data.csv"))
	if err != nil {
		return nil, err
	}
	byID := make(map[string]map[string]string, len(table.Rows))
	for _, row := range table.Rows {
		byID[row["uuid"]] = row
	}
	next := make([]map[string]string, 0, len(table.Rows))
	seen := map[string]bool{}
	for _, id := range rowIDs {
		if row, ok := byID[id]; ok {
			next = append(next, row)
			seen[id] = true
		}
	}
	for _, row := range table.Rows {
		if seen[row["uuid"]] {
			continue
		}
		next = append(next, row)
	}
	if err := databasecsv.Write(filepath.Join(dbDir, "data.csv"), headerForConfig(cfg), next); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return s.ListRows(spaceSlug, dbID, 0, 0)
}

func (s *DatabaseService) GetRow(spaceSlug, dbID, rowID string) (*model.DatabaseRow, error) {
	root, dir, _, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	table, err := databasecsv.Read(filepath.Join(root, dir, "data.csv"))
	if err != nil {
		return nil, err
	}
	for _, row := range table.Rows {
		if row["uuid"] == rowID {
			vals := map[string]string{}
			for k, v := range row {
				if k != "uuid" {
					vals[k] = v
				}
			}
			return &model.DatabaseRow{UUID: rowID, Values: vals}, nil
		}
	}
	return nil, errors.New("row not found")
}

func (s *DatabaseService) UpdateRow(spaceSlug, dbID, rowID, username string, values map[string]string) (*model.DatabaseRow, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	now := unixTimestampString(time.Now().UTC())
	var updated *model.DatabaseRow
	err = s.rewriteRows(filepath.Join(root, dir), cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			if row["uuid"] != rowID {
				continue
			}
			for _, c := range cfg.Columns {
				if c.Readonly {
					continue
				}
				if v, ok := values[c.ID]; ok {
					row[c.ID] = v
				}
			}
			for _, c := range cfg.Columns {
				if c.Type == "last_edited_time" {
					row[c.ID] = now
				}
				if c.Type == "last_edited_user" {
					row[c.ID] = username
				}
			}
			vals := map[string]string{}
			for k, v := range row {
				if k != "uuid" {
					vals[k] = v
				}
			}
			updated = &model.DatabaseRow{UUID: rowID, Values: vals}
		}
		return rows
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, errors.New("row not found")
	}
	_ = s.rebuildAllLinked(spaceSlug)
	s.markGitDirty(spaceSlug)
	return updated, nil
}

func (s *DatabaseService) DeleteRow(spaceSlug, dbID, rowID string) error {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()
	dbDir := filepath.Join(root, dir)
	var deletedRow map[string]string
	table, err := databasecsv.Read(filepath.Join(dbDir, "data.csv"))
	if err != nil {
		return err
	}
	for _, row := range table.Rows {
		if row["uuid"] == rowID {
			deletedRow = cloneStringMap(row)
			break
		}
	}
	if deletedRow == nil {
		return errors.New("row not found")
	}
	if err := s.writeRowTrashPackage(spaceSlug, root, dir, cfg, rowID, deletedRow); err != nil {
		return err
	}
	err = s.rewriteRows(filepath.Join(root, dir), cfg, func(rows []map[string]string) []map[string]string {
		next := rows[:0]
		for _, row := range rows {
			if row["uuid"] == rowID {
				continue
			}
			next = append(next, row)
		}
		return next
	})
	if err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(root, dir, "subpages", rowID+".md"))
	_ = s.rebuildAllLinked(spaceSlug)
	s.markGitDirty(spaceSlug)
	return nil
}

func (s *DatabaseService) RestoreTrashedRow(spaceSlug, trashRelPath string, trash frontmatter.DatabaseTrashData, spaceID int) (*model.Page, error) {
	if trash.Type != "database_row" || trash.DatabaseID == "" || trash.RowID == "" {
		return nil, errors.New("invalid database row trash metadata")
	}
	root, dir, cfg, err := s.findDB(spaceSlug, trash.DatabaseID)
	if err != nil {
		return nil, err
	}
	unlock := s.lockDBs([]string{s.lockKey(spaceSlug, dir)})
	defer unlock()

	trashAbsPath := filepath.Join(s.docsDir, trashRelPath)
	raw, err := os.ReadFile(trashAbsPath)
	if err != nil {
		return nil, err
	}
	fm, body, _ := frontmatter.Parse(raw)
	fm.DatabaseTrash = nil
	if fm.ID == "" {
		fm.ID = trash.RowID
	}
	if fm.Title == "" {
		fm.Title = s.titleFromValues(cfg, trash.RowValues)
	}
	if fm.Type == "" {
		fm.Type = "database-row"
	}
	if fm.DB == "" {
		fm.DB = cfg.ID
	}

	targetRelPath := filepath.Join(spaceSlug, "_database", dir, "subpages", trash.RowID+".md")
	targetAbsPath := filepath.Join(s.docsDir, targetRelPath)
	wrotePage := false
	if trash.RestorePageBinding {
		if _, err := os.Stat(targetAbsPath); err == nil {
			return nil, fmt.Errorf("row page already exists")
		}
		if err := os.MkdirAll(filepath.Dir(targetAbsPath), 0755); err != nil {
			return nil, err
		}
		if err := databasecsv.AtomicWriteFile(targetAbsPath, frontmatter.Render(fm, body), 0644); err != nil {
			return nil, err
		}
		wrotePage = true
	}

	if err := s.restoreRowValues(root, dir, cfg, trash.RowID, trash.RowValues); err != nil {
		if wrotePage {
			_ = os.Remove(targetAbsPath)
		}
		return nil, err
	}
	if err := os.Remove(trashAbsPath); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	trashChildDir := strings.TrimSuffix(trashAbsPath, ".md")
	if info, err := os.Stat(trashChildDir); err == nil && info.IsDir() {
		if trash.RestorePageBinding {
			targetChildDir := strings.TrimSuffix(targetAbsPath, ".md")
			_ = os.Rename(trashChildDir, targetChildDir)
		} else {
			_ = os.RemoveAll(trashChildDir)
		}
	}
	_ = s.rebuildAllLinked(spaceSlug)
	s.markGitDirty(spaceSlug)
	return &model.Page{ID: trash.RowID, Title: fm.Title, FilePath: targetRelPath}, nil
}

func (s *DatabaseService) GetRowPage(spaceSlug, dbID, rowID string) (*model.DatabaseRowPage, error) {
	root, dir, cfg, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return nil, err
	}
	if _, err := s.GetRow(spaceSlug, dbID, rowID); err != nil {
		return nil, err
	}
	title := s.rowTitle(spaceSlug, dbID, rowID, cfg)
	path := filepath.Join(root, dir, "subpages", rowID+".md")
	if raw, err := os.ReadFile(path); err == nil {
		return &model.DatabaseRowPage{Markdown: string(raw), Title: title}, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	md := fmt.Sprintf("---\nid: %s\ntitle: \"%s\"\ntype: database-row\ndb: %s\n---\n\n", rowID, strings.ReplaceAll(title, `"`, `\"`), cfg.ID)
	if err := databasecsv.AtomicWriteFile(path, []byte(md), 0644); err != nil {
		return nil, err
	}
	s.markGitDirty(spaceSlug)
	return &model.DatabaseRowPage{Markdown: md, Title: title}, nil
}

func (s *DatabaseService) PutRowPage(spaceSlug, dbID, rowID, markdown string) error {
	root, dir, _, err := s.findDB(spaceSlug, dbID)
	if err != nil {
		return err
	}
	if _, err := s.GetRow(spaceSlug, dbID, rowID); err != nil {
		return err
	}
	path := filepath.Join(root, dir, "subpages", rowID+".md")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	if err := databasecsv.AtomicWriteFile(path, []byte(markdown), 0644); err != nil {
		return err
	}
	s.markGitDirty(spaceSlug)
	return nil
}

func (s *DatabaseService) writeRowTrashPackage(spaceSlug, root, dir string, cfg *model.DatabaseConfig, rowID string, row map[string]string) error {
	dbDir := filepath.Join(root, dir)
	pagePath := filepath.Join(dbDir, "subpages", rowID+".md")
	raw, err := os.ReadFile(pagePath)
	pageExisted := err == nil
	body := ""
	fm := frontmatter.FrontmatterData{
		ID:    rowID,
		Title: s.titleFromValues(cfg, row),
		Type:  "database-row",
		DB:    cfg.ID,
	}
	if pageExisted {
		parsed, parsedBody, _ := frontmatter.Parse(raw)
		fm = parsed
		body = parsedBody
		if fm.ID == "" {
			fm.ID = rowID
		}
		if fm.Title == "" {
			fm.Title = s.titleFromValues(cfg, row)
		}
		if fm.Type == "" {
			fm.Type = "database-row"
		}
		if fm.DB == "" {
			fm.DB = cfg.ID
		}
	}
	values := cloneStringMap(row)
	delete(values, "uuid")
	displayValues := s.rowDisplayValues(cfg, values)
	fm.DatabaseTrash = &frontmatter.DatabaseTrashData{
		Type:                    "database_row",
		DatabaseID:              cfg.ID,
		DatabaseDir:             dir,
		DatabaseName:            cfg.Name,
		RowID:                   rowID,
		PageExistedBeforeDelete: pageExisted,
		RestorePageBinding:      pageExisted,
		DeletedAt:               time.Now().UTC().Format(time.RFC3339),
		RowValues:               values,
		RowDisplayValues:        displayValues,
	}
	trashRel, trashAbs, err := s.databaseRowTrashPath(spaceSlug, dir, rowID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(trashAbs), 0755); err != nil {
		return err
	}
	if err := databasecsv.AtomicWriteFile(trashAbs, frontmatter.Render(fm, body), 0644); err != nil {
		return err
	}
	if pageExisted {
		childDir := strings.TrimSuffix(pagePath, ".md")
		if info, err := os.Stat(childDir); err == nil && info.IsDir() {
			trashChild := strings.TrimSuffix(filepath.Join(s.docsDir, trashRel), ".md")
			_ = os.RemoveAll(trashChild)
			_ = os.Rename(childDir, trashChild)
		}
	}
	return nil
}

func (s *DatabaseService) rowDisplayValues(cfg *model.DatabaseConfig, values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for _, col := range cfg.Columns {
		raw := strings.TrimSpace(values[col.ID])
		if raw == "" {
			continue
		}
		display := strings.TrimSpace(databaseColumnDisplayValue(col, raw))
		if display != "" {
			out[col.ID] = display
		}
	}
	for key, raw := range values {
		if _, ok := out[key]; ok {
			continue
		}
		if display := strings.TrimSpace(raw); display != "" {
			out[key] = display
		}
	}
	return out
}

func databaseColumnDisplayValue(col model.DatabaseColumn, raw string) string {
	switch col.Type {
	case "select", "status":
		if option, ok := databaseOptionByID(col, raw); ok {
			return option
		}
	case "multi_select", "linked":
		var ids []string
		if err := json.Unmarshal([]byte(raw), &ids); err == nil {
			labels := make([]string, 0, len(ids))
			for _, id := range ids {
				if label, ok := databaseOptionByID(col, id); ok {
					labels = append(labels, label)
				} else if trimmed := strings.TrimSpace(id); trimmed != "" {
					labels = append(labels, trimmed)
				}
			}
			return strings.Join(labels, "、")
		}
	}
	return raw
}

func databaseOptionByID(col model.DatabaseColumn, id string) (string, bool) {
	options, ok := col.Config["options"].([]any)
	if !ok {
		return "", false
	}
	for _, item := range options {
		option, ok := item.(map[string]any)
		if !ok || fmt.Sprint(option["id"]) != id {
			continue
		}
		value := strings.TrimSpace(fmt.Sprint(option["value"]))
		if value == "" {
			value = strings.TrimSpace(fmt.Sprint(option["name"]))
		}
		return value, value != ""
	}
	return "", false
}

func (s *DatabaseService) databaseRowTrashPath(spaceSlug, dir, rowID string) (string, string, error) {
	spaceDir, actualSlug, err := s.resolveSpaceDir(spaceSlug)
	if err != nil {
		return "", "", err
	}
	base := filepath.Join("_database_"+dir+"_subpages", rowID+".md")
	rel := filepath.Join(actualSlug, ".trash", base)
	abs := filepath.Join(spaceDir, ".trash", base)
	counter := 2
	for {
		if _, err := os.Stat(abs); os.IsNotExist(err) {
			return rel, abs, nil
		}
		base = filepath.Join("_database_"+dir+"_subpages", fmt.Sprintf("%s %d.md", rowID, counter))
		rel = filepath.Join(actualSlug, ".trash", base)
		abs = filepath.Join(spaceDir, ".trash", base)
		counter++
	}
}

func (s *DatabaseService) restoreRowValues(root, dir string, cfg *model.DatabaseConfig, rowID string, values map[string]string) error {
	dbDir := filepath.Join(root, dir)
	exists := false
	if err := s.rewriteRows(dbDir, cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			if row["uuid"] == rowID {
				exists = true
				return rows
			}
		}
		row := map[string]string{"uuid": rowID}
		for _, c := range cfg.Columns {
			row[c.ID] = defaultCell(c)
			if c.Type == "formula" {
				continue
			}
			if values != nil {
				if value, ok := values[c.ID]; ok {
					row[c.ID] = value
				}
			}
		}
		rows = append(rows, row)
		return rows
	}); err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("row already exists")
	}
	return nil
}

func (s *DatabaseService) titleFromValues(cfg *model.DatabaseConfig, values map[string]string) string {
	for _, c := range cfg.Columns {
		if c.Type == "text" && strings.TrimSpace(values[c.ID]) != "" {
			return values[c.ID]
		}
	}
	return "Untitled"
}

func cloneStringMap(src map[string]string) map[string]string {
	dst := make(map[string]string, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func (s *DatabaseService) findDB(spaceSlug, dbID string) (string, string, *model.DatabaseConfig, error) {
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return "", "", nil, err
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return root, "", nil, errors.New("database not found")
	}
	if err != nil {
		return "", "", nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		cfg, err := s.readConfigByDir(root, e.Name())
		if err == nil && (cfg.ID == dbID || e.Name() == dbID) {
			return root, e.Name(), cfg, nil
		}
	}
	return root, "", nil, errors.New("database not found")
}

func (s *DatabaseService) readConfigByDir(root, dir string) (*model.DatabaseConfig, error) {
	raw, err := os.ReadFile(filepath.Join(root, dir, "config.json"))
	if err != nil {
		return nil, err
	}
	var cfg model.DatabaseConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *DatabaseService) writeConfig(dbDir string, cfg *model.DatabaseConfig) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return databasecsv.AtomicWriteFile(filepath.Join(dbDir, "config.json"), raw, 0644)
}

func (s *DatabaseService) rewriteRows(dbDir string, cfg *model.DatabaseConfig, mutate func([]map[string]string) []map[string]string) error {
	path := filepath.Join(dbDir, "data.csv")
	table, err := databasecsv.Read(path)
	if err != nil {
		return err
	}
	rows := mutate(table.Rows)
	header := headerForConfig(cfg)
	return databasecsv.Write(path, header, rows)
}

func headerForConfig(cfg *model.DatabaseConfig) []string {
	header := []string{"uuid"}
	linked := []string{}
	for _, c := range cfg.Columns {
		if c.Type == "formula" {
			continue
		}
		if c.Type == "linked" {
			linked = append(linked, c.ID)
		} else {
			header = append(header, c.ID)
		}
	}
	sort.Strings(linked)
	return append(header, linked...)
}

func summaryFromConfig(cfg model.DatabaseConfig, dir string, rows int) model.DatabaseSummary {
	return model.DatabaseSummary{ID: cfg.ID, Name: cfg.Name, DirName: dir, Icon: cfg.Icon, Description: cfg.Description, CreatedAt: cfg.CreatedAt, ColumnCount: len(cfg.Columns), RowCount: rows}
}
func detailFromConfig(cfg model.DatabaseConfig, dir string, rows int) model.DatabaseDetail {
	return model.DatabaseDetail{DatabaseSummary: summaryFromConfig(cfg, dir, rows), Columns: cfg.Columns}
}

func defaultCell(c model.DatabaseColumn) string {
	if c.Type == "multi_select" || c.Type == "linked" {
		return "[]"
	}
	if c.Type == "checkbox" {
		return "false"
	}
	if c.Default != nil {
		return fmt.Sprint(c.Default)
	}
	return ""
}

func unixTimestampString(t time.Time) string {
	return fmt.Sprint(t.Unix())
}

func (s *DatabaseService) rowTitle(spaceSlug, dbID, rowID string, cfg *model.DatabaseConfig) string {
	row, err := s.GetRow(spaceSlug, dbID, rowID)
	if err != nil {
		return "Untitled"
	}
	for _, c := range cfg.Columns {
		if c.Type == "text" && strings.TrimSpace(row.Values[c.ID]) != "" {
			return row.Values[c.ID]
		}
	}
	return "Untitled"
}

func (s *DatabaseService) relationTargetDirs(spaceSlug string, cfg *model.DatabaseConfig) ([]string, error) {
	var dirs []string
	for _, c := range cfg.Columns {
		if c.Type != "relation" {
			continue
		}
		id, _ := c.Config["target_db_id"].(string)
		if id == "" {
			continue
		}
		_, dir, _, err := s.findDB(spaceSlug, id)
		if err == nil {
			dirs = append(dirs, dir)
		}
	}
	return dirs, nil
}

func (s *DatabaseService) ensureLinkedColumn(spaceSlug, targetDir string, src *model.DatabaseConfig, relation model.DatabaseColumn) error {
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return err
	}
	cfg, err := s.readConfigByDir(root, targetDir)
	if err != nil {
		return err
	}
	id := "_linked_from_" + src.ID
	for i := range cfg.Columns {
		if cfg.Columns[i].ID == id {
			cfg.Columns[i].Config["src_relation_col_id"] = relation.ID
			return s.writeConfig(filepath.Join(root, targetDir), cfg)
		}
	}
	cfg.Columns = append(cfg.Columns, model.DatabaseColumn{
		ID: id, Name: "来自" + src.Name, Type: "linked", Readonly: true, Auto: true,
		Config: map[string]any{"src_db_id": src.ID, "src_db_name": src.Name, "src_relation_col_id": relation.ID},
	})
	dbDir := filepath.Join(root, targetDir)
	if err := s.writeConfig(dbDir, cfg); err != nil {
		return err
	}
	return s.rewriteRows(dbDir, cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			row[id] = "[]"
		}
		return rows
	})
}

func (s *DatabaseService) removeLinkedColumn(spaceSlug, targetDir, srcDBID string) error {
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return err
	}
	cfg, err := s.readConfigByDir(root, targetDir)
	if err != nil {
		return err
	}
	id := "_linked_from_" + srcDBID
	next := cfg.Columns[:0]
	for _, c := range cfg.Columns {
		if c.ID != id {
			next = append(next, c)
		}
	}
	cfg.Columns = next
	dbDir := filepath.Join(root, targetDir)
	if err := s.writeConfig(dbDir, cfg); err != nil {
		return err
	}
	return s.rewriteRows(dbDir, cfg, func(rows []map[string]string) []map[string]string {
		for _, row := range rows {
			delete(row, id)
		}
		return rows
	})
}

func (s *DatabaseService) rebuildAllLinked(spaceSlug string) error {
	root, err := s.databaseRoot(spaceSlug)
	if err != nil {
		return err
	}
	list, err := s.List(spaceSlug)
	if err != nil {
		return err
	}
	for _, sum := range list {
		cfg, err := s.readConfigByDir(root, sum.DirName)
		if err != nil {
			continue
		}
		for _, c := range cfg.Columns {
			if c.Type != "linked" {
				continue
			}
			_ = s.rewriteRows(filepath.Join(root, sum.DirName), cfg, func(rows []map[string]string) []map[string]string {
				for _, row := range rows {
					row[c.ID] = "[]"
				}
				return rows
			})
		}
	}
	for _, sum := range list {
		cfg, err := s.readConfigByDir(root, sum.DirName)
		if err != nil {
			continue
		}
		table, err := databasecsv.Read(filepath.Join(root, sum.DirName, "data.csv"))
		if err != nil {
			continue
		}
		for _, col := range cfg.Columns {
			if col.Type != "relation" {
				continue
			}
			targetID, _ := col.Config["target_db_id"].(string)
			if targetID == "" {
				continue
			}
			_, targetDir, targetCfg, err := s.findDB(spaceSlug, targetID)
			if err != nil {
				continue
			}
			linkedID := "_linked_from_" + cfg.ID
			_ = s.rewriteRows(filepath.Join(root, targetDir), targetCfg, func(targetRows []map[string]string) []map[string]string {
				byID := map[string]map[string]string{}
				for _, tr := range targetRows {
					byID[tr["uuid"]] = tr
				}
				for _, row := range table.Rows {
					for _, targetRowID := range relationIDs(row[col.ID]) {
						tr := byID[targetRowID]
						if tr == nil {
							continue
						}
						items := linkedItems(tr[linkedID])
						items = append(items, map[string]string{"row_uuid": row["uuid"], "col_id": col.ID})
						raw, _ := json.Marshal(items)
						tr[linkedID] = string(raw)
					}
				}
				return targetRows
			})
		}
	}
	return nil
}

func relationIDs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if strings.HasPrefix(raw, "[") {
		var ids []string
		_ = json.Unmarshal([]byte(raw), &ids)
		return ids
	}
	return []string{raw}
}

func linkedItems(raw string) []map[string]string {
	var items []map[string]string
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &items)
	}
	if items == nil {
		items = []map[string]string{}
	}
	return items
}
