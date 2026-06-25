package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/alwaysking/akmdlibrary/internal/model"
)

type SpaceRepository struct {
	db *DB
}

func NewSpaceRepository(db *DB) *SpaceRepository {
	return &SpaceRepository{db: db}
}

func (r *SpaceRepository) Create(space *model.CreateSpaceRequest, slug string) (*model.Space, error) {
	query := `
		INSERT INTO spaces (name, slug, icon, description, feature_flags)
		VALUES (?, ?, ?, ?, '{}')
	`

	result, err := r.db.Exec(query, space.Name, slug, space.Icon, space.Description)
	if err != nil {
		return nil, fmt.Errorf("failed to create space: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert id: %w", err)
	}

	return r.GetByID(int(id))
}

func (r *SpaceRepository) GetByID(id int) (*model.Space, error) {
	query := `
		SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
		FROM spaces WHERE id = ?
	`

	var space model.Space
	var icon, description sql.NullString
	var featureFlags string
	err := r.db.QueryRow(query, id).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
	)
	space.FeatureFlags = json.RawMessage(featureFlags)

	if icon.Valid {
		space.Icon = icon.String
	}
	if description.Valid {
		space.Description = description.String
	}

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("space not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get space: %w", err)
	}

	return &space, nil
}

func (r *SpaceRepository) GetBySlug(slug string) (*model.Space, error) {
	query := `
		SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
		FROM spaces WHERE slug = ?
	`

	var space model.Space
	var icon, description sql.NullString
	var featureFlags string
	err := r.db.QueryRow(query, slug).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
	)
	space.FeatureFlags = json.RawMessage(featureFlags)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("space not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get space: %w", err)
	}

	if icon.Valid {
		space.Icon = icon.String
	}
	if description.Valid {
		space.Description = description.String
	}

	return &space, nil
}

func (r *SpaceRepository) ListByUserID(userID int) ([]*model.Space, error) {
	// userID == 0 means return all spaces (used by admin)
	// Otherwise, only return spaces where the user is a member
	var query string
	var rows *sql.Rows
	var err error

	if userID == 0 {
		query = `
			SELECT id, name, slug, icon, description, feature_flags, created_at, updated_at
			FROM spaces
			ORDER BY created_at DESC
		`
		rows, err = r.db.Query(query)
	} else {
		query = `
			SELECT DISTINCT s.id, s.name, s.slug, s.icon, s.description, s.feature_flags, s.created_at, s.updated_at
			FROM spaces s
			JOIN space_members sm ON s.id = sm.space_id
			WHERE sm.user_id = ?
			ORDER BY s.created_at DESC
		`
		rows, err = r.db.Query(query, userID)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to list spaces: %w", err)
	}
	defer rows.Close()

	spaces := make([]*model.Space, 0)
	for rows.Next() {
		var space model.Space
		var icon, description sql.NullString
		var featureFlags string
		if err := rows.Scan(
			&space.ID, &space.Name, &space.Slug, &icon,
			&description, &featureFlags, &space.CreatedAt, &space.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan space: %w", err)
		}

		if icon.Valid {
			space.Icon = icon.String
		}
		if description.Valid {
			space.Description = description.String
		}
		space.FeatureFlags = json.RawMessage(featureFlags)

		spaces = append(spaces, &space)
	}

	return spaces, nil
}

func (r *SpaceRepository) Update(id int, req *model.UpdateSpaceRequest) (*model.Space, error) {
	setParts := []string{}
	args := []interface{}{}

	if req.Name != nil {
		setParts = append(setParts, "name = ?")
		args = append(args, *req.Name)
	}
	if req.Slug != nil {
		setParts = append(setParts, "slug = ?")
		args = append(args, *req.Slug)
	}
	if req.Icon != nil {
		setParts = append(setParts, "icon = ?")
		args = append(args, *req.Icon)
	}
	if req.Description != nil {
		setParts = append(setParts, "description = ?")
		args = append(args, *req.Description)
	}
	setParts = append(setParts, "updated_at = CURRENT_TIMESTAMP")

	query := "UPDATE spaces SET " + joinArgs(setParts) + " WHERE id = ?"
	args = append(args, id)

	if _, err := r.db.Exec(query, args...); err != nil {
		return nil, fmt.Errorf("failed to update space: %w", err)
	}

	return r.GetByID(id)
}

// UpdateFeatureFlags overwrites the feature_flags JSON column for a space.
func (r *SpaceRepository) UpdateFeatureFlags(slug string, flagsJSON string) error {
	result, err := r.db.Exec(
		`UPDATE spaces SET feature_flags = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?`,
		flagsJSON, slug,
	)
	if err != nil {
		return fmt.Errorf("failed to update feature_flags: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("space not found")
	}
	return nil
}

func (r *SpaceRepository) Delete(id int) error {
	query := "DELETE FROM spaces WHERE id = ?"

	result, err := r.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete space: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("space not found")
	}

	return nil
}

func (r *SpaceRepository) SyncFromFS(spaces []*model.Space) error {
	// Build a set of slugs from filesystem
	fsSlugs := make(map[string]bool)
	for _, space := range spaces {
		fsSlugs[space.Slug] = true
	}

	// Remove database entries that no longer exist in filesystem
	allSpaces, err := r.ListByUserID(0)
	if err != nil {
		return fmt.Errorf("failed to list spaces: %w", err)
	}
	for _, dbSpace := range allSpaces {
		if !fsSlugs[dbSpace.Slug] {
			if err := r.Delete(dbSpace.ID); err != nil {
				return fmt.Errorf("failed to remove stale space %s: %w", dbSpace.Slug, err)
			}
		}
	}

	// Upsert filesystem spaces
	for _, space := range spaces {
		existing, err := r.GetBySlug(space.Slug)
		if err == nil {
			// Update if exists — only update Name from FS, preserve Icon/Description
			req := &model.UpdateSpaceRequest{
				Name: &space.Name,
			}
			if space.Icon != "" {
				req.Icon = &space.Icon
			}
			if space.Description != "" {
				req.Description = &space.Description
			}
			_, err = r.Update(existing.ID, req)
			if err != nil {
				return fmt.Errorf("failed to sync space %s: %w", space.Slug, err)
			}
		} else {
			// Create if doesn't exist
			_, err = r.Create(&model.CreateSpaceRequest{
				Name:        space.Name,
				Icon:        space.Icon,
				Description: space.Description,
			}, space.Slug)
			if err != nil {
				return fmt.Errorf("failed to create space %s: %w", space.Slug, err)
			}
		}
	}
	return nil
}
