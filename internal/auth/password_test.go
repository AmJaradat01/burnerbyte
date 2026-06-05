package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

func TestValidatePassword(t *testing.T) {
	// Every class required, min length 8.
	strict := config.PasswordConfig{
		MinLength:        8,
		RequireUppercase: true,
		RequireLowercase: true,
		RequireNumber:    true,
		RequireSpecial:   true,
	}
	// Length only, no class requirements.
	lenient := config.PasswordConfig{MinLength: 6}

	tests := []struct {
		name    string
		pw      string
		cfg     config.PasswordConfig
		wantErr string // substring to find in the error; "" means expect success
	}{
		{"strict valid", "Abcdef1!", strict, ""},
		{"exactly min length", "Abcde1!A", strict, ""},
		{"too short", "Ab1!", strict, "at least 8"},
		{"missing uppercase", "abcdef1!", strict, "uppercase"},
		{"missing lowercase", "ABCDEF1!", strict, "lowercase"},
		{"missing number", "Abcdefg!", strict, "number"},
		{"missing special", "Abcdefg1", strict, "special"},
		{"lenient ignores classes", "abcdef", lenient, ""},
		{"lenient too short", "abc", lenient, "at least 6"},
		{"over 72 bytes rejected", strings.Repeat("a", 73), lenient, "72 bytes"},
		{"exactly 72 bytes ok", strings.Repeat("a", 72), lenient, ""},
		{"unicode symbol satisfies special", "Abcdef1€", strict, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.pw, tt.cfg)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected success, got error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}

func TestResolveBcryptCost(t *testing.T) {
	tests := []struct {
		name string
		cost int
		want int
	}{
		{"in range", bcrypt.MinCost + 2, bcrypt.MinCost + 2},
		{"min boundary", bcrypt.MinCost, bcrypt.MinCost},
		{"max boundary", bcrypt.MaxCost, bcrypt.MaxCost},
		{"below min falls back to default", bcrypt.MinCost - 1, bcrypt.DefaultCost},
		{"above max falls back to default", bcrypt.MaxCost + 1, bcrypt.DefaultCost},
		{"zero falls back to default", 0, bcrypt.DefaultCost},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveBcryptCost(config.PasswordConfig{BcryptCost: tt.cost})
			if got != tt.want {
				t.Fatalf("ResolveBcryptCost(%d) = %d, want %d", tt.cost, got, tt.want)
			}
		})
	}
}

func TestValidateDisplayName(t *testing.T) {
	if err := ValidateDisplayName(""); err == nil {
		t.Fatal("empty display name should be rejected")
	}
	if err := ValidateDisplayName(strings.Repeat("x", 201)); err == nil {
		t.Fatal("201-character display name should be rejected")
	}
	if err := ValidateDisplayName("Ali Jaradat"); err != nil {
		t.Fatalf("valid display name should pass, got %v", err)
	}
	if err := ValidateDisplayName(strings.Repeat("x", 200)); err != nil {
		t.Fatalf("200-character display name (boundary) should pass, got %v", err)
	}
}

func TestHashAndCheckPassword(t *testing.T) {
	// Minimum cost keeps the test fast; the bound is exercised by
	// TestResolveBcryptCost separately.
	cfg := config.PasswordConfig{BcryptCost: bcrypt.MinCost}
	const pw = "Sup3r!secret"

	hash, err := HashPassword(pw, cfg)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if hash == pw {
		t.Fatal("hash must not equal the plaintext password")
	}
	if !CheckPassword(hash, pw) {
		t.Fatal("the correct password should verify against its hash")
	}
	if CheckPassword(hash, "wrong-password") {
		t.Fatal("an incorrect password must not verify")
	}
	// Timing-attack guard for unknown users: must run without panicking.
	DummyCheckPassword("anything")
}
