package auth

import (
	"fmt"
	"unicode"

	"golang.org/x/crypto/bcrypt"

	"github.com/amjaradat01/burnerbyte/internal/config"
)

// dummyHash is a pre-computed bcrypt hash used to prevent timing attacks.
// When a login attempt targets a non-existent email, we still run bcrypt
// against this hash so the response time is indistinguishable from a
// real password check.
var dummyHash = func() string {
	h, _ := bcrypt.GenerateFromPassword([]byte("timing-attack-dummy"), bcrypt.DefaultCost)
	return string(h)
}()

// ResolveBcryptCost returns the configured bcrypt cost, falling back to
// bcrypt.DefaultCost (10) if the configured value is out of range.
func ResolveBcryptCost(cfg config.PasswordConfig) int {
	if cfg.BcryptCost >= bcrypt.MinCost && cfg.BcryptCost <= bcrypt.MaxCost {
		return cfg.BcryptCost
	}
	return bcrypt.DefaultCost
}

func HashPassword(password string, cfg config.PasswordConfig) (string, error) {
	cost := ResolveBcryptCost(cfg)
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(bytes), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// DummyCheckPassword performs a bcrypt comparison against a dummy hash.
// This ensures that login attempts for non-existent users take the same
// amount of time as attempts for real users, preventing timing-based
// user enumeration.
func DummyCheckPassword(password string) {
	_ = bcrypt.CompareHashAndPassword([]byte(dummyHash), []byte(password))
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

// ValidateDisplayName checks that a display name is within acceptable bounds.
func ValidateDisplayName(name string) error {
	if len(name) == 0 {
		return fmt.Errorf("display name is required")
	}
	if len(name) > 200 {
		return fmt.Errorf("display name must not exceed 200 characters")
	}
	return nil
}
