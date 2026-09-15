package handler

import "testing"

// redactDSN feeds the setup wizard's "which datastore am I about to write to?"
// display. It runs before any account exists, so it must never echo a password
// back — including when the DSN is malformed and url.Parse gives up.
func TestRedactDSN(t *testing.T) {
	tests := []struct {
		name, dsn, want string
	}{
		{"postgres with credentials", "postgres://burnerbyte:s3cret@postgres:5432/burnerbyte?sslmode=disable", "postgres:5432/burnerbyte"},
		{"redis with password", "redis://:s3cret@redis:6379", "redis:6379"},
		{"redis with db index", "redis://localhost:6379/0", "localhost:6379/0"},
		{"no credentials", "postgres://db.internal:5432/app", "db.internal:5432/app"},
		{"empty", "", "(not configured)"},
		{"whitespace only", "   ", "(not configured)"},
		{"no host", "postgres://", "(unparsable)"},
		{"garbage", "://:::", "(unparsable)"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := redactDSN(tc.dsn); got != tc.want {
				t.Errorf("redactDSN(%q) = %q, want %q", tc.dsn, got, tc.want)
			}
		})
	}
}

// The property that actually matters: no output may contain the secret.
func TestRedactDSNNeverLeaksPassword(t *testing.T) {
	for _, dsn := range []string{
		"postgres://user:hunter2@host:5432/db",
		"redis://:hunter2@host:6379/0",
		"postgres://user:hunter2@host:5432/db?sslmode=verify-full&x=1",
		"not-a-url-hunter2",
		"://:hunter2",
	} {
		if got := redactDSN(dsn); contains(got, "hunter2") {
			t.Errorf("redactDSN(%q) = %q, leaks the password", dsn, got)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
