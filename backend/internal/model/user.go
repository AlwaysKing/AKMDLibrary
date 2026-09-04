package model

import "time"

type User struct {
	ID           int       `json:"id" db:"id"`
	UUID         string    `json:"uuid" db:"uuid"`
	Username     string    `json:"username" db:"username"`
	PasswordHash string    `json:"-" db:"password_hash"`
	DisplayName  string    `json:"display_name" db:"display_name"`
	AvatarURL    string    `json:"avatar_url" db:"avatar_url"`
	Role         string    `json:"role" db:"role"` // "admin" | "user"
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type CreateUserRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Role        string `json:"role"`
}

type UpdateUserRequest struct {
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	Role        *string `json:"role"`
}
