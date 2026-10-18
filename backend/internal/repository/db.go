package repository

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

const CurrentSchemaVersion = 1

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
			uuid TEXT UNIQUE NOT NULL,
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
			is_locked BOOLEAN DEFAULT 0,
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
			sidebar_collapsed BOOLEAN DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS user_space_preferences (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			space_slug TEXT NOT NULL,
			last_viewed_page_id TEXT,
			expanded_page_ids TEXT DEFAULT '[]',
			collapsed_sections TEXT DEFAULT '{}',
			quick_access_expanded_ids TEXT DEFAULT '[]',
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
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, schema := range schemas {
		if _, err := db.Exec(schema); err != nil {
			return fmt.Errorf("failed to execute schema: %w", err)
		}
	}

	if err := ensureUserUUIDs(db.DB); err != nil {
		return err
	}

	// Incremental migrations: SQLite 不支持 ADD COLUMN IF NOT EXISTS，所以尝试执行并忽略 "duplicate column" 错误
	if _, err := db.Exec(`ALTER TABLE user_global_preferences ADD COLUMN unsplash_api_key TEXT`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_global_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE user_global_preferences ADD COLUMN sidebar_width INTEGER`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_global_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE user_global_preferences ADD COLUMN code_theme TEXT`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_global_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE user_global_preferences ADD COLUMN sidebar_collapsed BOOLEAN DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_global_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE user_space_preferences ADD COLUMN collapsed_sections TEXT DEFAULT '{}'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_space_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE user_space_preferences ADD COLUMN quick_access_expanded_ids TEXT DEFAULT '[]'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate user_space_preferences: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE pages ADD COLUMN is_locked BOOLEAN DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate pages: %w", err)
		}
	}
	if _, err := db.Exec(`ALTER TABLE spaces ADD COLUMN feature_flags TEXT NOT NULL DEFAULT '{}'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("failed to migrate spaces.feature_flags: %w", err)
		}
	}

	if err := ensureSchemaVersion(db.DB); err != nil {
		return err
	}

	return nil
}

func ensureSchemaVersion(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&version); err != nil {
		return fmt.Errorf("failed to read schema version: %w", err)
	}
	if version > CurrentSchemaVersion {
		return fmt.Errorf(
			"database schema version %d is newer than supported version %d",
			version,
			CurrentSchemaVersion,
		)
	}
	if version < CurrentSchemaVersion {
		if _, err := db.Exec(
			`INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, CURRENT_TIMESTAMP)`,
			CurrentSchemaVersion,
		); err != nil {
			return fmt.Errorf("failed to record schema version: %w", err)
		}
	}
	return nil
}

func ensureUserUUIDs(db *sql.DB) error {
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN uuid TEXT`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return fmt.Errorf("failed to migrate users.uuid: %w", err)
	}
	rows, err := db.Query(`SELECT id FROM users WHERE uuid IS NULL OR uuid = ''`)
	if err != nil {
		return fmt.Errorf("failed to query users for uuid migration: %w", err)
	}
	ids := make([]int, 0)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan user id for uuid migration: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("failed to close user uuid migration rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate users for uuid migration: %w", err)
	}
	for _, id := range ids {
		if _, err := db.Exec(`UPDATE users SET uuid = ? WHERE id = ?`, uuid.NewString(), id); err != nil {
			return fmt.Errorf("failed to backfill user uuid: %w", err)
		}
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid)`); err != nil {
		return fmt.Errorf("failed to create users uuid index: %w", err)
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
		INSERT INTO users (uuid, username, password_hash, display_name, role)
		VALUES (?, 'admin', '$2a$10$LBJML4PwvM12AVd.qPS/Z.MjEUE.UGFThWrMdEVj.poS5ZC3qwypm', 'Admin', 'admin')
	`, uuid.NewString())
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
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		file_path TEXT NOT NULL,
		icon TEXT,
		cover_url TEXT,
		full_page BOOLEAN DEFAULT 0,
		is_locked BOOLEAN DEFAULT 0,
		sort_order REAL DEFAULT 0,
		is_starred BOOLEAN DEFAULT 0,
		last_accessed_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("failed to create pages table: %w", err)
	}

	// Migrate existing space caches incrementally and fail fast on real errors.
	for _, stmt := range []string{
		"ALTER TABLE pages ADD COLUMN is_locked BOOLEAN DEFAULT 0",
		"ALTER TABLE pages ADD COLUMN is_starred BOOLEAN DEFAULT 0",
		"ALTER TABLE pages ADD COLUMN last_accessed_at DATETIME",
	} {
		if _, err := db.Exec(stmt); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return nil, fmt.Errorf("failed to migrate space database %s: %w", dbPath, err)
		}
	}

	return db, nil
}
