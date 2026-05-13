package service

import (
	"fmt"

	"github.com/alwaysking/mdlibrary/internal/model"
	"github.com/alwaysking/mdlibrary/internal/repository"
)

type UserService struct {
	userRepo    *repository.UserRepository
	authService *AuthService
}

func NewUserService(userRepo *repository.UserRepository, authService *AuthService) *UserService {
	return &UserService{
		userRepo:    userRepo,
		authService: authService,
	}
}

func (s *UserService) List() ([]*model.User, error) {
	return s.userRepo.List()
}

func (s *UserService) Create(req *model.CreateUserRequest) (*model.User, error) {
	// Hash password
	passwordHash, err := s.authService.HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Set defaults
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	if req.Role == "" {
		req.Role = "user"
	}

	return s.userRepo.Create(req, passwordHash)
}

func (s *UserService) GetByID(id int) (*model.User, error) {
	return s.userRepo.GetByID(id)
}

func (s *UserService) Update(id int, req *model.UpdateUserRequest) (*model.User, error) {
	return s.userRepo.Update(id, req)
}

func (s *UserService) Delete(id int) error {
	return s.userRepo.Delete(id)
}

func (s *UserService) ResetPassword(id int, newPassword string) error {
	passwordHash, err := s.authService.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}
	return s.userRepo.UpdatePassword(id, passwordHash)
}
