package repository

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	*sql.DB
}

func NewDB(dataDir string) (*DB, error) {
	db, err := sql.Open("sqlite3", fmt.Sprintf("%s/data.db", dataDir))
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	repo := &DB{DB: db}

	if err := repo.migrate(); err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	if err := repo.seedAdmin(); err != nil {
		return nil, fmt.Errorf("failed to seed admin user: %w", err)
	}

	return repo, nil
}

func (db *DB) migrate() error {
	schemas := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			display_name TEXT,
			avatar_url TEXT,
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS spaces (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			slug TEXT UNIQUE NOT NULL,
			icon TEXT,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS pages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			space_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			file_path TEXT NOT NULL,
			icon TEXT,
			cover_url TEXT,
			full_page BOOLEAN DEFAULT 0,
			sort_order REAL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS space_members (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			space_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			role TEXT NOT NULL DEFAULT 'viewer',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(space_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pages_space_id ON pages(space_id)`,
		`CREATE INDEX IF NOT EXISTS idx_space_members_space_id ON space_members(space_id)`,
		`CREATE INDEX IF NOT EXISTS idx_space_members_user_id ON space_members(user_id)`,
		`CREATE TABLE IF NOT EXISTS user_global_preferences (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL UNIQUE,
			last_active_space_slug TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS user_space_preferences (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			space_slug TEXT NOT NULL,
			last_viewed_page_id INTEGER,
			expanded_page_ids TEXT DEFAULT '[]',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, space_slug)
		)`,
		`CREATE TABLE IF NOT EXISTS site_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS bookmark_meta (
			url TEXT PRIMARY KEY,
			title TEXT,
			description TEXT,
			favicon_url TEXT,
			image_url TEXT,
			fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL
		)`,
	}

	for _, schema := range schemas {
		if _, err := db.Exec(schema); err != nil {
			return fmt.Errorf("failed to execute schema: %w", err)
		}
	}

	return nil
}

func (db *DB) seedAdmin() error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE username = 'admin'").Scan(&count); err != nil {
		return fmt.Errorf("failed to check admin user: %w", err)
	}

	if count > 0 {
		return nil
	}

	_, err := db.Exec(`
		INSERT INTO users (username, password_hash, display_name, role)
		VALUES ('admin', '$2a$10$LBJML4PwvM12AVd.qPS/Z.MjEUE.UGFThWrMdEVj.poS5ZC3qwypm', 'Admin', 'admin')
	`)
	if err != nil {
		return fmt.Errorf("failed to create admin user: %w", err)
	}

	return nil
}

// OpenSpaceDB opens (or creates) a per-space cache database at spaceDir/.cache.db.
// The database contains only the pages table (no space_id needed).
func OpenSpaceDB(spaceDir string) (*sql.DB, error) {
	dbPath := fmt.Sprintf("%s/.cache.db", spaceDir)
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open space database: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping space database: %w", err)
	}

	// Create pages table (no space_id — each DB is for one space)
	schema := `CREATE TABLE IF NOT EXISTS pages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		file_path TEXT NOT NULL,
		icon TEXT,
		cover_url TEXT,
		full_page BOOLEAN DEFAULT 0,
		sort_order REAL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("failed to create pages table: %w", err)
	}

	// Migrate: add is_starred and last_accessed_at columns if missing
	db.Exec("ALTER TABLE pages ADD COLUMN is_starred BOOLEAN DEFAULT 0")
	db.Exec("ALTER TABLE pages ADD COLUMN last_accessed_at DATETIME")

	return db, nil
}
