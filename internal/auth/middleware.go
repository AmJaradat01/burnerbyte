package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type contextKey string

const UserContextKey contextKey = "user"

type UserContext struct {
	UserID        uuid.UUID
	Email         string
	IsSystemAdmin bool
	APIKeyScopes  []string // non-nil only for API key auth
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
				if err := apikeyRepo.UpdateLastUsed(r.Context(), key.ID); err != nil {
					slog.Error("failed to update API key last_used", "error", err, "key_id", key.ID)
				}

				// Resolve the key creator as the user context
				user, err := userRepo.GetByID(r.Context(), key.CreatedBy)
				if err != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key user not found"})
					return
				}
				ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
					UserID:        user.ID,
					Email:         user.Email,
					IsSystemAdmin: false, // API keys never grant system admin
					APIKeyScopes:  key.Scopes,
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
				if claims.IssuedAt.Before(*user.PasswordChangedAt) {
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

			userID, err := uuid.Parse(claims.Subject)
			if err != nil {
				next.ServeHTTP(w, r) // Invalid subject — treat as unauthenticated
				return
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

// HasScope checks if the user context has the required scope.
// Returns true for JWT-authenticated users (no scope restrictions).
// Returns false for API key users missing the required scope.
func HasScope(ctx context.Context, scope string) bool {
	uc := GetUser(ctx)
	if uc == nil {
		return false
	}
	if uc.APIKeyScopes == nil {
		return true // JWT auth — no scope restrictions
	}
	for _, s := range uc.APIKeyScopes {
		if s == scope {
			return true
		}
	}
	return false
}

// writeJSON is a minimal helper to avoid importing handler package.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if m, ok := v.(map[string]string); ok {
		b, _ := json.Marshal(m)
		w.Write(b)
	}
}

// Placeholder for rate limiting state check
