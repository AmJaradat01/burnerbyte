package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

// ===========================================================================
// Feature: audit-metadata-completeness — verify handlers emit complete audit
// metadata. A capturing AuditRecorder records the metadata maps handlers build;
// handlers run against the local test DB and skip when none is reachable.
// ===========================================================================

type capturedAudit struct {
	action       string
	resourceID   uuid.UUID
	resourceName string
	ip           string
	meta         map[string]any
}

// capturingRecorder implements the handler AuditRecorder interface.
type capturingRecorder struct{ calls []capturedAudit }

func (c *capturingRecorder) RecordFromRequest(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, metadata any) {
	m, _ := metadata.(map[string]any)
	c.calls = append(c.calls, capturedAudit{action: action, resourceID: resourceID, ip: r.RemoteAddr, meta: m})
}

func (c *capturingRecorder) RecordEnhanced(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata map[string]any) {
	c.calls = append(c.calls, capturedAudit{action: action, resourceID: resourceID, resourceName: resourceName, ip: r.RemoteAddr, meta: metadata})
}

func (c *capturingRecorder) find(action string) *capturedAudit {
	for i := range c.calls {
		if c.calls[i].action == action {
			return &c.calls[i]
		}
	}
	return nil
}

func handlerTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:password@localhost:5432/burnerbyte_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("integration test DB unavailable (%v); set TEST_DATABASE_URL to run", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("integration test DB not reachable (%v); set TEST_DATABASE_URL to run", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newAuthTestHandler(t *testing.T, pool *pgxpool.Pool) (*AuthHandler, *config.Config) {
	cfg := &config.Config{JWT: config.JWTConfig{
		Secret:     "test-secret-key-at-least-32-bytes-long!!",
		AccessTTL:  15 * 60 * 1e9,          // 15m
		RefreshTTL: 7 * 24 * 60 * 60 * 1e9, // 7d
	}}
	cfg.Defaults.AllowRegistration = true
	cfg.Password.BcryptCost = 4
	tokens := auth.NewTokenManager(cfg.JWT)
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	t.Cleanup(func() { _ = rdb.Close() })
	lockout := auth.NewLockout(rdb, 5, 15*60*1e9)
	svc := service.NewAuthService(
		pool, postgres.NewUserRepo(pool), postgres.NewSessionRepo(pool),
		nil, nil, nil, nil, nil, nil, nil,
		tokens, lockout, nil, cfg, nil, nil, nil,
	)
	return NewAuthHandler(svc, nil, cfg), cfg
}

// installCapture swaps the package Audit recorder for a capturing fake.
func installCapture(t *testing.T) *capturingRecorder {
	t.Helper()
	cap := &capturingRecorder{}
	prev := Audit
	Audit = cap
	t.Cleanup(func() { Audit = prev })
	return cap
}

// registerUser registers a fresh user via the handler and returns its id,
// email, and password.
func registerUser(t *testing.T, h *AuthHandler) (uuid.UUID, string, string) {
	t.Helper()
	email := "u-" + uuid.New().String()[:8] + "@corp.com"
	password := "Str0ng-Passw0rd!"
	body, _ := json.Marshal(map[string]any{"email": email, "password": password, "display_name": "Test Person"})
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.RemoteAddr = "203.0.113.1:1000"
	w := httptest.NewRecorder()
	h.Register(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("register precondition: status %d, body %s", w.Code, w.Body.String())
	}
	var resp struct {
		User struct {
			ID uuid.UUID `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse register response: %v", err)
	}
	return resp.User.ID, email, password
}

// authReq builds a request carrying an authenticated user context.
func authReq(method, target string, body []byte, userID uuid.UUID, email string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	req.RemoteAddr = "198.51.100.1:2000"
	ctx := context.WithValue(req.Context(), auth.UserContextKey,
		&auth.UserContext{UserID: userID, Email: email, DisplayName: "Test Person"})
	return req.WithContext(ctx)
}

// Bug: user.password_changed metadata must include sessions_revoked.
func TestAuditMetadata_PasswordChanged(t *testing.T) {
	pool := handlerTestPool(t)
	h, _ := newAuthTestHandler(t, pool)
	uid, email, password := registerUser(t, h)
	cap := installCapture(t)

	body, _ := json.Marshal(map[string]any{"current_password": password, "new_password": "NewStr0ng-Pass1!"})
	w := httptest.NewRecorder()
	h.ChangePassword(w, authReq(http.MethodPost, "/auth/change-password", body, uid, email))
	if w.Code != http.StatusOK {
		t.Fatalf("change password: status %d, body %s", w.Code, w.Body.String())
	}

	ca := cap.find("user.password_changed")
	if ca == nil {
		t.Fatal("expected a user.password_changed audit entry")
	}
	if ca.meta["sessions_revoked"] != true {
		t.Errorf("metadata.sessions_revoked = %v, want true", ca.meta["sessions_revoked"])
	}
}

// Bug: session.revoked_all metadata must include revoked_count.
func TestAuditMetadata_SessionRevokedAll(t *testing.T) {
	pool := handlerTestPool(t)
	h, _ := newAuthTestHandler(t, pool)
	uid, email, _ := registerUser(t, h) // registration creates one session
	cap := installCapture(t)

	w := httptest.NewRecorder()
	h.RevokeAllSessions(w, authReq(http.MethodPost, "/auth/sessions/revoke-all", nil, uid, email))
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke all: status %d, body %s", w.Code, w.Body.String())
	}

	ca := cap.find("session.revoked_all")
	if ca == nil {
		t.Fatal("expected a session.revoked_all audit entry")
	}
	c, ok := ca.meta["revoked_count"].(int)
	if !ok || c < 1 {
		t.Errorf("metadata.revoked_count = %v, want >= 1", ca.meta["revoked_count"])
	}
}

// Bug: user.account_deleted metadata must include display_name.
func TestAuditMetadata_AccountDeleted(t *testing.T) {
	pool := handlerTestPool(t)
	h, _ := newAuthTestHandler(t, pool)
	uid, email, password := registerUser(t, h)
	cap := installCapture(t)

	body, _ := json.Marshal(map[string]any{"password": password})
	w := httptest.NewRecorder()
	h.DeleteAccount(w, authReq(http.MethodDelete, "/auth/account", body, uid, email))
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete account: status %d, body %s", w.Code, w.Body.String())
	}

	ca := cap.find("user.account_deleted")
	if ca == nil {
		t.Fatal("expected a user.account_deleted audit entry")
	}
	if ca.meta["display_name"] != "Test Person" {
		t.Errorf("metadata.display_name = %v, want \"Test Person\"", ca.meta["display_name"])
	}
}

// Bug 1.1: user.registered metadata must include display_name AND ip_address,
// and resource_id must be the new user's id (not uuid.Nil).
func TestAuditMetadata_UserRegistered(t *testing.T) {
	pool := handlerTestPool(t)
	h, _ := newAuthTestHandler(t, pool)
	cap := installCapture(t)

	email := "reg-" + uuid.New().String()[:8] + "@corp.com"
	body, _ := json.Marshal(map[string]any{
		"email": email, "password": "Str0ng-Passw0rd!", "display_name": "Reg User",
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.RemoteAddr = "203.0.113.9:5555"
	w := httptest.NewRecorder()

	h.Register(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("register: status %d, body %s", w.Code, w.Body.String())
	}

	ca := cap.find("user.registered")
	if ca == nil {
		t.Fatal("expected a user.registered audit entry")
	}
	if ca.meta["display_name"] != "Reg User" {
		t.Errorf("metadata.display_name = %v, want \"Reg User\"", ca.meta["display_name"])
	}
	if ip, _ := ca.meta["ip_address"].(string); ip == "" {
		t.Errorf("metadata.ip_address missing/empty: %v", ca.meta["ip_address"])
	}
	if ca.resourceID == uuid.Nil {
		t.Error("resource_id should be the new user's id, got uuid.Nil")
	}
}

// Bug 1.2: user.login metadata must include ip_address AND login_method.
func TestAuditMetadata_UserLogin(t *testing.T) {
	pool := handlerTestPool(t)
	h, _ := newAuthTestHandler(t, pool)

	email := "login-" + uuid.New().String()[:8] + "@corp.com"
	password := "Str0ng-Passw0rd!"

	// Register the user first (audit not captured yet, so this is a no-op record).
	regBody, _ := json.Marshal(map[string]any{"email": email, "password": password, "display_name": "Login User"})
	regReq := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(regBody))
	regReq.RemoteAddr = "203.0.113.9:1111"
	regW := httptest.NewRecorder()
	h.Register(regW, regReq)
	if regW.Code != http.StatusCreated {
		t.Fatalf("register precondition: status %d, body %s", regW.Code, regW.Body.String())
	}

	// Now capture and log in.
	cap := installCapture(t)
	loginBody, _ := json.Marshal(map[string]any{"email": email, "password": password})
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(loginBody))
	req.RemoteAddr = "198.51.100.7:2222"
	req.Header.Set("User-Agent", "audit-test-agent")
	w := httptest.NewRecorder()

	h.Login(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login: status %d, body %s", w.Code, w.Body.String())
	}

	ca := cap.find("user.login")
	if ca == nil {
		t.Fatal("expected a user.login audit entry")
	}
	if ca.meta["login_method"] != "password" {
		t.Errorf("metadata.login_method = %v, want \"password\"", ca.meta["login_method"])
	}
	if ip, _ := ca.meta["ip_address"].(string); ip == "" {
		t.Errorf("metadata.ip_address missing/empty: %v", ca.meta["ip_address"])
	}
}
