package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// APIKeyRepo is the minimal interface for API key validation.
type APIKeyRepo interface {
	GetByHash(ctx context.Context, hash string) (*domain.APIKey, error)
	UpdateLastUsed(ctx context.Context, id uuid.UUID) error
}

// UserRepo is the minimal interface the middleware needs to check password_changed_at.
type UserRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

func Middleware(tm *TokenManager, userRepo UserRepo, apikeyRepo APIKeyRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			// WebSocket connections can't set headers — allow token via query param
			if header == "" {
				if t := r.URL.Query().Get("token"); t != "" {
					header = "Bearer " + t
				}
			}
			if header == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid authorization format"})
				return
			}

			token := parts[1]

			// API key auth: tokens starting with "bb_"
			if strings.HasPrefix(token, "bb_") && apikeyRepo != nil {
				hash := sha256.Sum256([]byte(token))
				keyHash := hex.EncodeToString(hash[:])
				key, err := apikeyRepo.GetByHash(r.Context(), keyHash)
				if err != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid API key"})
					return
				}
				if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key expired"})
					return
				}
				_ = apikeyRepo.UpdateLastUsed(r.Context(), key.ID)

				// Resolve the key creator as the user context
				user, err := userRepo.GetByID(r.Context(), key.CreatedBy)
				if err != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key user not found"})
					return
				}
				ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
					UserID:        user.ID,
					Email:         user.Email,
					IsSystemAdmin: user.IsSystemAdmin,
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// JWT auth
			claims, err := tm.ValidateAccessToken(token)
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
