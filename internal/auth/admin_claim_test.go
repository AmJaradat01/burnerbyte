package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/domain"
)

type stubUserRepo struct{ user *domain.User }

func (s *stubUserRepo) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return s.user, nil
}

// A token minted while the user was a system admin must stop granting system
// admin the moment the flag is cleared in the database. Reading
// claims.IsSystemAdmin instead left the demoted account fully privileged for
// the remainder of the access-token TTL — 15 minutes by default.
func TestSystemAdminComesFromTheDatabaseNotTheToken(t *testing.T) {
	userID := uuid.New()
	tm := NewTokenManager(config.JWTConfig{
		Secret:    "test-secret-at-least-thirty-two-characters",
		AccessTTL: 15 * time.Minute,
	})

	// Minted while still an admin.
	token, err := tm.GenerateAccessToken(userID, "admin@example.com", true)
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name    string
		inDB    bool
		wantAdm bool
	}{
		{"still an admin in the database", true, true},
		{"demoted in the database", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubUserRepo{user: &domain.User{
				ID:            userID,
				Email:         "admin@example.com",
				DisplayName:   "Admin",
				IsSystemAdmin: tc.inDB,
			}}

			var got *UserContext
			h := Middleware(tm, repo, nil, nil)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = GetUser(r.Context())
			}))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("request rejected: %d", rec.Code)
			}
			if got == nil {
				t.Fatal("no user context")
			}
			if got.IsSystemAdmin != tc.wantAdm {
				t.Errorf("IsSystemAdmin = %v, want %v (token claim says true)", got.IsSystemAdmin, tc.wantAdm)
			}
		})
	}
}

// RequireSystemAdmin is the gate the transfer/admin routes hang off, so the
// demotion has to be visible there too.
func TestRequireSystemAdminRejectsDemotedUser(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), UserContextKey, &UserContext{
		UserID:        uuid.New(),
		IsSystemAdmin: false,
	})

	called := false
	RequireSystemAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})).ServeHTTP(rec, req.WithContext(ctx))

	if called {
		t.Error("handler ran for a non-admin")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}
