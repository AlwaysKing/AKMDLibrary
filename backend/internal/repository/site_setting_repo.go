package repository

import (
	"database/sql"
	"fmt"
)

type SiteSettingRepository struct {
	db *DB
}

func NewSiteSettingRepository(db *DB) *SiteSettingRepository {
	return &SiteSettingRepository{db: db}
}

func (r *SiteSettingRepository) Get(key string) (string, error) {
	var value string
	err := r.db.QueryRow("SELECT value FROM site_settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get site setting %s: %w", key, err)
	}
	return value, nil
}

func (r *SiteSettingRepository) Set(key, value string) error {
	_, err := r.db.Exec(`
		INSERT INTO site_settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`, key, value)
	if err != nil {
		return fmt.Errorf("failed to set site setting %s: %w", key, err)
	}
	return nil
}
