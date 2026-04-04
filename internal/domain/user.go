package domain

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID                uuid.UUID  `json:"id"`
	Email             string     `json:"email"`
	DisplayName       string     `json:"display_name"`
	AvatarURL         *string    `json:"avatar_url,omitempty"`
	PasswordHash      *string    `json:"-"`
	SSOProvider       *string    `json:"sso_provider,omitempty"`
	SSOSubject        *string    `json:"-"`
	IsSystemAdmin     bool       `json:"is_system_admin"`
	EmailVerified     bool       `json:"email_verified"`
	PasswordChangedAt *time.Time `json:"-"`
	Timezone          *string    `json:"timezone,omitempty"`
	DateFormat        *string    `json:"date_format,omitempty"`
	TimeFormat        *string    `json:"time_format,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type CreateUserInput struct {
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type RefreshInput struct {
	RefreshToken string `json:"refresh_token"`
}

type ForgotPasswordInput struct {
	Email string `json:"email"`
}

type ResetPasswordInput struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

type ChangePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type UpdateProfileInput struct {
	DisplayName *string `json:"display_name,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	Timezone    *string `json:"timezone,omitempty"`
	DateFormat  *string `json:"date_format,omitempty"`
	TimeFormat  *string `json:"time_format,omitempty"`
}

type DeleteAccountInput struct {
	Password string `json:"password"`
}

type Session struct {
	ID               uuid.UUID  `json:"id"`
	UserID           uuid.UUID  `json:"user_id"`
	RefreshTokenHash string     `json:"-"`
	TokenFamily      uuid.UUID  `json:"-"`
	IPAddress        *string    `json:"ip_address,omitempty"`
	UserAgent        *string    `json:"user_agent,omitempty"`
	LastUsedAt       time.Time  `json:"last_used_at"`
	ExpiresAt        time.Time  `json:"expires_at"`
	Revoked          bool       `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
}
