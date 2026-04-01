package auth

import (
	"fmt"
	"unicode"

	"golang.org/x/crypto/bcrypt"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(bytes), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func ValidatePassword(password string, cfg config.PasswordConfig) error {
	if len(password) < cfg.MinLength {
		return fmt.Errorf("password must be at least %d characters", cfg.MinLength)
	}
	// bcrypt silently truncates at 72 bytes — reject longer passwords
	if len([]byte(password)) > 72 {
		return fmt.Errorf("password must not exceed 72 bytes")
	}

	var hasUpper, hasLower, hasNumber, hasSpecial bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasNumber = true
		case unicode.IsPunct(c) || unicode.IsSymbol(c):
			hasSpecial = true
		}
	}

	if cfg.RequireUppercase && !hasUpper {
		return fmt.Errorf("password must contain at least 1 uppercase letter")
	}
	if cfg.RequireLowercase && !hasLower {
		return fmt.Errorf("password must contain at least 1 lowercase letter")
	}
	if cfg.RequireNumber && !hasNumber {
		return fmt.Errorf("password must contain at least 1 number")
	}
	if cfg.RequireSpecial && !hasSpecial {
		return fmt.Errorf("password must contain at least 1 special character")
	}

	return nil
}
