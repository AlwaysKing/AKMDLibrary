package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/alwaysking/mdlibrary/internal/model"
)

type UserRepository struct {
	db *DB
}

func NewUserRepository(db *DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(user *model.CreateUserRequest, passwordHash string) (*model.User, error) {
	query := `
		INSERT INTO users (username, password_hash, display_name, avatar_url, role)
		VALUES (?, ?, ?, ?, ?)
	`

	result, err := r.db.Exec(query, user.Username, passwordHash, user.DisplayName, user.AvatarURL, user.Role)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert id: %w", err)
	}

	return r.GetByID(int(id))
}

func (r *UserRepository) GetByID(id int) (*model.User, error) {
	query := `
		SELECT id, username, password_hash, display_name, avatar_url, role, created_at, updated_at
		FROM users WHERE id = ?
	`

	var user model.User
	var avatarURL sql.NullString
	err := r.db.QueryRow(query, id).Scan(
		&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName,
		&avatarURL, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if avatarURL.Valid {
		user.AvatarURL = avatarURL.String
	}

	return &user, nil
}

func (r *UserRepository) GetByUsername(username string) (*model.User, error) {
	query := `
		SELECT id, username, password_hash, display_name, avatar_url, role, created_at, updated_at
		FROM users WHERE username = ?
	`

	var user model.User
	var avatarURL sql.NullString
	err := r.db.QueryRow(query, username).Scan(
		&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName,
		&avatarURL, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if avatarURL.Valid {
		user.AvatarURL = avatarURL.String
	}

	return &user, nil
}

func (r *UserRepository) List() ([]*model.User, error) {
	query := `
		SELECT id, username, password_hash, display_name, avatar_url, role, created_at, updated_at
		FROM users ORDER BY created_at DESC
	`

	rows, err := r.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer rows.Close()

	var users []*model.User
	for rows.Next() {
		var user model.User
		var avatarURL sql.NullString
		if err := rows.Scan(
			&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName,
			&avatarURL, &user.Role, &user.CreatedAt, &user.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}

		if avatarURL.Valid {
			user.AvatarURL = avatarURL.String
		}

		users = append(users, &user)
	}

	return users, nil
}

func (r *UserRepository) Update(id int, req *model.UpdateUserRequest) (*model.User, error) {
	updates := []string{}
	args := []interface{}{}
	argPos := 1

	if req.DisplayName != nil {
		updates = append(updates, fmt.Sprintf("display_name = $%d", argPos))
		args = append(args, *req.DisplayName)
		argPos++
	}

	if req.AvatarURL != nil {
		updates = append(updates, fmt.Sprintf("avatar_url = $%d", argPos))
		args = append(args, *req.AvatarURL)
		argPos++
	}

	if req.Role != nil {
		updates = append(updates, fmt.Sprintf("role = $%d", argPos))
		args = append(args, *req.Role)
		argPos++
	}

	if len(updates) == 0 {
		return r.GetByID(id)
	}

	updates = append(updates, fmt.Sprintf("updated_at = $%d", argPos))
	args = append(args, time.Now())
	argPos++

	query := fmt.Sprintf("UPDATE users SET %s WHERE id = $%d",
		joinArgs(updates), argPos)
	args = append(args, id)

	// SQLite uses ? instead of $1, $2, etc.
	query = fmt.Sprintf("UPDATE users SET %s WHERE id = ?", joinArgs(updates))
	// Replace $n with ? for SQLite
	for range updates {
		query = fmt.Sprintf(query, "?")
	}
	query = query + " WHERE id = ?"

	// Simplified approach
	setClause := ""
	for i, update := range updates {
		if i > 0 {
			setClause += ", "
		}
		setClause += update
	}

	// Rebuild for SQLite
	setParts := []string{}
	if req.DisplayName != nil {
		setParts = append(setParts, "display_name = ?")
		args = append(args, *req.DisplayName)
	}
	if req.AvatarURL != nil {
		setParts = append(setParts, "avatar_url = ?")
		args = append(args, *req.AvatarURL)
	}
	if req.Role != nil {
		setParts = append(setParts, "role = ?")
		args = append(args, *req.Role)
	}
	setParts = append(setParts, "updated_at = ?")
	args = append(args, time.Now())

	query = "UPDATE users SET " + joinArgs(setParts) + " WHERE id = ?"
	args = append(args, id)

	if _, err := r.db.Exec(query, args...); err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	return r.GetByID(id)
}

func (r *UserRepository) Delete(id int) error {
	query := "DELETE FROM users WHERE id = ?"

	result, err := r.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

func joinArgs(parts []string) string {
	result := ""
	for i, part := range parts {
		if i > 0 {
			result += ", "
		}
		result += part
	}
	return result
}
