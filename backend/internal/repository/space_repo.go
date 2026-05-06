package repository

import (
	"database/sql"
	"fmt"

	"github.com/alwaysking/mdlibrary/internal/model"
)

type SpaceRepository struct {
	db *DB
}

func NewSpaceRepository(db *DB) *SpaceRepository {
	return &SpaceRepository{db: db}
}

func (r *SpaceRepository) Create(space *model.CreateSpaceRequest, slug string) (*model.Space, error) {
	query := `
		INSERT INTO spaces (name, slug, icon, description)
		VALUES (?, ?, ?, ?)
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
		SELECT id, name, slug, icon, description, created_at, updated_at
		FROM spaces WHERE id = ?
	`

	var space model.Space
	var icon, description sql.NullString
	err := r.db.QueryRow(query, id).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &space.CreatedAt, &space.UpdatedAt,
	)

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
		SELECT id, name, slug, icon, description, created_at, updated_at
		FROM spaces WHERE slug = ?
	`

	var space model.Space
	var icon, description sql.NullString
	err := r.db.QueryRow(query, slug).Scan(
		&space.ID, &space.Name, &space.Slug, &icon,
		&description, &space.CreatedAt, &space.UpdatedAt,
	)

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
	query := `
		SELECT DISTINCT s.id, s.name, s.slug, s.icon, s.description, s.created_at, s.updated_at
		FROM spaces s
		LEFT JOIN space_members sm ON s.id = sm.space_id
		WHERE s.id IN (
			SELECT space_id FROM space_members WHERE user_id = ?
			UNION
			SELECT id FROM spaces WHERE name IN (SELECT name FROM spaces)
		)
		ORDER BY s.created_at DESC
	`

	// For now, return all spaces (will implement proper permissions later)
	query = `
		SELECT id, name, slug, icon, description, created_at, updated_at
		FROM spaces
		ORDER BY created_at DESC
	`

	rows, err := r.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to list spaces: %w", err)
	}
	defer rows.Close()

	var spaces []*model.Space
	for rows.Next() {
		var space model.Space
		var icon, description sql.NullString
		if err := rows.Scan(
			&space.ID, &space.Name, &space.Slug, &icon,
			&description, &space.CreatedAt, &space.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan space: %w", err)
		}

		if icon.Valid {
			space.Icon = icon.String
		}
		if description.Valid {
			space.Description = description.String
		}

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
	for _, space := range spaces {
		// Try to get existing space
		existing, err := r.GetBySlug(space.Slug)
		if err == nil {
			// Update if exists
			_, err = r.Update(existing.ID, &model.UpdateSpaceRequest{
				Name:        &space.Name,
				Icon:        &space.Icon,
				Description: &space.Description,
			})
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
