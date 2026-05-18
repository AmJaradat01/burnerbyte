package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net"
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
	DisplayName   string
	IsSystemAdmin bool
	APIKeyScopes  []string // non-nil only for API key auth
}

// APIKeyRepo is the minimal interface for API key validation.
type APIKeyRepo interface {
	GetByHash(ctx context.Context, hash string) (*domain.APIKey, error)
	UpdateLastUsedWithTracking(ctx context.Context, id uuid.UUID, ip string) error
}

// UserRepo is the minimal interface the middleware needs to check password_changed_at.
type UserRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

// SessionRevocationChecker is the interface the middleware needs to check session revocations.
type SessionRevocationChecker interface {
	RevokedAt(ctx context.Context, userID uuid.UUID) int64
}

// TicketResolver resolves a one-time WebSocket ticket to a user ID.
// Returns the user ID and true if valid, or uuid.Nil and false if not found/expired.
type TicketResolver interface {
	Resolve(ctx context.Context, ticket string) (uuid.UUID, bool)
}

func Middleware(tm *TokenManager, userRepo UserRepo, apikeyRepo APIKeyRepo, revocationCache SessionRevocationChecker, ticketResolver ...TicketResolver) func(http.Handler) http.Handler {
	var resolver TicketResolver
	if len(ticketResolver) > 0 {
		resolver = ticketResolver[0]
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// WebSocket ticket auth — short-lived, one-time use
			if ticket := r.URL.Query().Get("ticket"); ticket != "" && resolver != nil {
				userID, ok := resolver.Resolve(r.Context(), ticket)
				if !ok {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired ticket"})
					return
				}
				user, err := userRepo.GetByID(r.Context(), userID)
				if err != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "user not found"})
					return
				}
				ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
					UserID:        user.ID,
					Email:         user.Email,
					DisplayName:   user.DisplayName,
					IsSystemAdmin: user.IsSystemAdmin,
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

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
				if key.RevokedAt != nil {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key revoked"})
					return
				}
				if !key.IsActive {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key disabled"})
					return
				}

				// IP allowlist enforcement
				if len(key.AllowedIPs) > 0 {
					remoteIP := extractIP(r.RemoteAddr)
					if !ipAllowed(remoteIP, key.AllowedIPs) {
						writeJSON(w, http.StatusForbidden, map[string]string{"error": "IP not allowed for this API key"})
						return
					}
				}

				// Usage tracking
				remoteIP := extractIP(r.RemoteAddr)
				if err := apikeyRepo.UpdateLastUsedWithTracking(r.Context(), key.ID, remoteIP); err != nil {
					slog.Error("failed to update API key tracking", "error", err, "key_id", key.ID)
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
					DisplayName:   user.DisplayName,
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

			// Check if sessions were revoked after this token was issued (session limit enforcement)
			if revocationCache != nil && claims.IssuedAt != nil {
				revokedAt := revocationCache.RevokedAt(r.Context(), userID)
				if revokedAt > 0 && claims.IssuedAt.Unix() < revokedAt {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session revoked"})
					return
				}
			}

			ctx := context.WithValue(r.Context(), UserContextKey, &UserContext{
				UserID:        userID,
				Email:         claims.Email,
				DisplayName:   user.DisplayName,
				IsSystemAdmin: claims.IsSystemAdmin,
			})

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// extractIP extracts the IP address from a RemoteAddr string, stripping the port.
func extractIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr // already just an IP
	}
	return host
}

// ipAllowed checks if the given IP matches any entry in the allowlist.
// Entries can be exact IPs or CIDR ranges.
func ipAllowed(ip string, allowedIPs []string) bool {
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false
	}
	for _, entry := range allowedIPs {
		// Try exact IP match
		if entryIP := net.ParseIP(entry); entryIP != nil {
			if entryIP.Equal(parsedIP) {
				return true
			}
			continue
		}
		// Try CIDR match
		if _, cidr, err := net.ParseCIDR(entry); err == nil {
			if cidr.Contains(parsedIP) {
				return true
			}
		}
	}
	return false
}

// OptionalAuth extracts user context if a token is present but doesn't require it.
// Note: This does not check password_changed_at (would require a DB lookup per request).
// Sensitive operations must use the full auth middleware which performs that check.
func OptionalAuth(tm *TokenManager, revocationCache ...SessionRevocationChecker) func(http.Handler) http.Handler {
	var revCache SessionRevocationChecker
	if len(revocationCache) > 0 {
		revCache = revocationCache[0]
	}

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

			// Check if sessions were revoked after this token was issued
			if revCache != nil && claims.IssuedAt != nil {
				revokedAt := revCache.RevokedAt(r.Context(), userID)
				if revokedAt > 0 && claims.IssuedAt.Unix() < revokedAt {
					next.ServeHTTP(w, r) // treat as unauthenticated
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
