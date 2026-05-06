package repository

import (
	"database/sql"
	"fmt"

	"github.com/alwaysking/mdlibrary/internal/model"
)

type MemberRepository struct {
	db *DB
}

func NewMemberRepository(db *DB) *MemberRepository {
	return &MemberRepository{db: db}
}

func (r *MemberRepository) Add(spaceID, userID int, role string) (*model.SpaceMember, error) {
	query := `
		INSERT INTO space_members (space_id, user_id, role)
		VALUES (?, ?, ?)
	`

	result, err := r.db.Exec(query, spaceID, userID, role)
	if err != nil {
		return nil, fmt.Errorf("failed to add member: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert id: %w", err)
	}

	return r.GetByID(int(id))
}

func (r *MemberRepository) GetByID(id int) (*model.SpaceMember, error) {
	query := `
		SELECT sm.id, sm.space_id, sm.user_id, sm.role, sm.created_at,
		       u.id, u.username, u.password_hash, u.display_name, u.avatar_url, u.role, u.created_at, u.updated_at
		FROM space_members sm
		JOIN users u ON sm.user_id = u.id
		WHERE sm.id = ?
	`

	var member model.SpaceMember
	var user model.User
	var userAvatarURL sql.NullString
	err := r.db.QueryRow(query, id).Scan(
		&member.ID, &member.SpaceID, &member.UserID, &member.Role, &member.CreatedAt,
		&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName,
		&userAvatarURL, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("member not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get member: %w", err)
	}

	if userAvatarURL.Valid {
		user.AvatarURL = userAvatarURL.String
	}

	member.User = &user
	return &member, nil
}

func (r *MemberRepository) GetBySpaceAndUser(spaceID, userID int) (*model.SpaceMember, error) {
	query := `
		SELECT id, space_id, user_id, role, created_at
		FROM space_members
		WHERE space_id = ? AND user_id = ?
	`

	var member model.SpaceMember
	err := r.db.QueryRow(query, spaceID, userID).Scan(
		&member.ID, &member.SpaceID, &member.UserID, &member.Role, &member.CreatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get member: %w", err)
	}

	return &member, nil
}

func (r *MemberRepository) ListBySpaceID(spaceID int) ([]*model.SpaceMember, error) {
	query := `
		SELECT sm.id, sm.space_id, sm.user_id, sm.role, sm.created_at,
		       u.id, u.username, u.password_hash, u.display_name, u.avatar_url, u.role, u.created_at, u.updated_at
		FROM space_members sm
		JOIN users u ON sm.user_id = u.id
		WHERE sm.space_id = ?
		ORDER BY sm.created_at ASC
	`

	rows, err := r.db.Query(query, spaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list members: %w", err)
	}
	defer rows.Close()

	var members []*model.SpaceMember
	for rows.Next() {
		var member model.SpaceMember
		var user model.User
		var userAvatarURL sql.NullString
		if err := rows.Scan(
			&member.ID, &member.SpaceID, &member.UserID, &member.Role, &member.CreatedAt,
			&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName,
			&userAvatarURL, &user.Role, &user.CreatedAt, &user.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan member: %w", err)
		}

		if userAvatarURL.Valid {
			user.AvatarURL = userAvatarURL.String
		}

		member.User = &user
		members = append(members, &member)
	}

	return members, nil
}

func (r *MemberRepository) Update(id int, role string) (*model.SpaceMember, error) {
	query := `UPDATE space_members SET role = ? WHERE id = ?`

	if _, err := r.db.Exec(query, role, id); err != nil {
		return nil, fmt.Errorf("failed to update member: %w", err)
	}

	return r.GetByID(id)
}

func (r *MemberRepository) Delete(id int) error {
	query := `DELETE FROM space_members WHERE id = ?`

	result, err := r.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete member: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("member not found")
	}

	return nil
}

func (r *MemberRepository) DeleteBySpaceAndUser(spaceID, userID int) error {
	query := `DELETE FROM space_members WHERE space_id = ? AND user_id = ?`

	_, err := r.db.Exec(query, spaceID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete member: %w", err)
	}

	return nil
}
