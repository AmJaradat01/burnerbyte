package auth

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type contextKey string

const UserContextKey contextKey = "user"

type UserContext struct {
	UserID        uuid.UUID
	Email         string
	IsSystemAdmin bool
}

// UserRepo is the minimal interface the middleware needs to check password_changed_at.
type UserRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

func Middleware(tm *TokenManager, userRepo UserRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid authorization format"})
				return
			}

			claims, err := tm.ValidateAccessToken(parts[1])
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
				return
			}

			userID, err := uuid.Parse(claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token subject"})
				return
			}

			// Check password_changed_at — reject tokens issued before password change
			user, err := userRepo.GetByID(r.Context(), userID)
			if err != nil {
				slog.Error("auth middleware: failed to get user", "error", err, "user_id", userID)
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "user not found"})
				return
			}

			if user.PasswordChangedAt != nil && claims.IssuedAt != nil {
				if claims.IssuedAt.Time.Before(*user.PasswordChangedAt) {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "token invalidated by password change"})
					return
				}
			}

			ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
				UserID:        userID,
				Email:         claims.Email,
				IsSystemAdmin: claims.IsSystemAdmin,
			})

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuth extracts user context if a token is present but doesn't require it.
func OptionalAuth(tm *TokenManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				next.ServeHTTP(w, r)
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				next.ServeHTTP(w, r)
				return
			}

			claims, err := tm.ValidateAccessToken(parts[1])
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}

			userID, _ := uuid.Parse(claims.Subject)
			ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
				UserID:        userID,
				Email:         claims.Email,
				IsSystemAdmin: claims.IsSystemAdmin,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireSystemAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uc := GetUser(r.Context())
		if uc == nil || !uc.IsSystemAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "system admin required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUser(ctx context.Context) *UserContext {
	uc, _ := ctx.Value(UserContextKey).(*UserContext)
	return uc
}

// writeJSON is a minimal helper to avoid importing handler package.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// Minimal inline JSON for auth errors — no encoding/json import needed for simple maps
	if m, ok := v.(map[string]string); ok {
		w.Write([]byte(`{"error":"` + m["error"] + `"}`))
	}
}

// Placeholder for rate limiting state check
var _ = time.Now
