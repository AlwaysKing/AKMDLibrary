package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/alwaysking/akmdlibrary/internal/model"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	userRepo  *repository.UserRepository
	jwtSecret string
}

func NewAuthService(userRepo *repository.UserRepository, jwtSecret string) *AuthService {
	return &AuthService{
		userRepo:  userRepo,
		jwtSecret: jwtSecret,
	}
}

func (s *AuthService) Login(username, password string) (*model.LoginResponse, error) {
	user, err := s.userRepo.GetByUsername(username)
	if err != nil {
		return nil, errors.New("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, errors.New("invalid credentials")
	}

	token, err := s.GenerateAccessToken(user.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	// Don't return password hash
	user.PasswordHash = ""

	return &model.LoginResponse{
		Token: token,
		User:  user,
	}, nil
}

func (s *AuthService) Me(userID int) (*model.User, error) {
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return nil, err
	}

	// Don't return password hash
	user.PasswordHash = ""

	return user, nil
}

func (s *AuthService) GenerateAccessToken(userID int) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"type":    "access",
		"exp":     time.Now().Add(time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	return token.SignedString([]byte(s.jwtSecret))
}

func (s *AuthService) GenerateRefreshToken(userID int, rememberMe bool) (string, time.Duration, error) {
	ttl := 24 * time.Hour
	if rememberMe {
		ttl = 30 * 24 * time.Hour
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"type":    "refresh",
		"exp":     time.Now().Add(ttl).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(s.jwtSecret))
	if err != nil {
		return "", 0, err
	}

	return tokenString, ttl, nil
}

func (s *AuthService) VerifyToken(tokenString string) (int, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.jwtSecret), nil
	})

	if err != nil {
		return 0, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		tokenType, _ := claims["type"].(string)
		// Accept legacy tokens without a type claim so existing sessions are not
		// forced out immediately after deployment.
		if tokenType != "" && tokenType != "access" {
			return 0, errors.New("invalid token type")
		}
		return userIDFromClaims(claims)
	}

	return 0, errors.New("invalid token")
}

func (s *AuthService) VerifyRefreshToken(tokenString string) (int, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.jwtSecret), nil
	})

	if err != nil {
		return 0, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		if tokenType, _ := claims["type"].(string); tokenType != "refresh" {
			return 0, errors.New("invalid token type")
		}
		return userIDFromClaims(claims)
	}

	return 0, errors.New("invalid token")
}

func (s *AuthService) Refresh(refreshToken string) (*model.LoginResponse, error) {
	userID, err := s.VerifyRefreshToken(refreshToken)
	if err != nil {
		return nil, err
	}

	user, err := s.Me(userID)
	if err != nil {
		return nil, err
	}

	token, err := s.GenerateAccessToken(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	return &model.LoginResponse{
		Token: token,
		User:  user,
	}, nil
}

func userIDFromClaims(claims jwt.MapClaims) (int, error) {
	userIDValue, ok := claims["user_id"].(float64)
	if !ok {
		return 0, errors.New("missing user_id")
	}
	return int(userIDValue), nil
}

func (s *AuthService) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func (s *AuthService) UpdateProfile(userID int, displayName, avatarURL *string) (*model.User, error) {
	return s.userRepo.Update(userID, &model.UpdateUserRequest{
		DisplayName: displayName,
		AvatarURL:   avatarURL,
	})
}

func (s *AuthService) ChangePassword(userID int, oldPassword, newPassword string) error {
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return errors.New("user not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return errors.New("old password is incorrect")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	return s.userRepo.UpdatePassword(userID, string(hash))
}
