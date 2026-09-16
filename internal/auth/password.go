package auth

import (
	"fmt"
	"sync"
	"unicode"

	"golang.org/x/crypto/bcrypt"

	"github.com/amjaradat01/burnerbyte/internal/config"
)

// dummyHashes holds one pre-computed bcrypt hash per cost, used to keep a
// login against a non-existent email as slow as a real password check.
//
// A single hash pinned to bcrypt.DefaultCost only equalises the timing while
// the configured cost happens to be 10. Raising password_policy.bcrypt_cost
// made real checks measurably slower than the dummy and quietly turned this
// defence into the user-enumeration oracle it exists to prevent, so the
// dummy is now derived from the same resolved cost.
var (
	dummyHashMu sync.Mutex
	dummyHashes = map[int]string{}
)

func dummyHashForCost(cost int) string {
	dummyHashMu.Lock()
	defer dummyHashMu.Unlock()
	if h, ok := dummyHashes[cost]; ok {
		return h
	}
	h, err := bcrypt.GenerateFromPassword([]byte("timing-attack-dummy"), cost)
	if err != nil {
		// Only reachable for an out-of-range cost, which ResolveBcryptCost
		// already excludes; fall back rather than fail the login path.
		h, _ = bcrypt.GenerateFromPassword([]byte("timing-attack-dummy"), bcrypt.DefaultCost)
	}
	dummyHashes[cost] = string(h)
	return string(h)
}

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

// DummyCheckPassword performs a bcrypt comparison against a dummy hash of the
// configured cost, so a login for a non-existent user takes the same time as
// one for a real user and cannot be told apart.
func DummyCheckPassword(password string, cfg config.PasswordConfig) {
	cost := ResolveBcryptCost(cfg)
	_ = bcrypt.CompareHashAndPassword([]byte(dummyHashForCost(cost)), []byte(password))
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
