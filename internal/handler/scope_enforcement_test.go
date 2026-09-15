package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
)

// reqWithScopes builds a request authenticated as an API key carrying the given
// scopes. reqWithJWT builds a session/JWT request (no API-key scopes).
func reqWithScopes(scopes []string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	uc := &auth.UserContext{APIKeyScopes: scopes}
	return r.WithContext(context.WithValue(r.Context(), auth.UserContextKey, uc))
}

func reqWithJWT() *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	uc := &auth.UserContext{} // APIKeyScopes nil => session/JWT auth
	return r.WithContext(context.WithValue(r.Context(), auth.UserContextKey, uc))
}

// TestDenyByScope guards the fix that confines an API key to its granted scopes
// on every org/team permission check, so a narrowly-scoped key can't inherit the
// creator's full authority.
func TestDenyByScope(t *testing.T) {
	// A read-only emails key must be denied a key-management operation.
	if w := httptest.NewRecorder(); !denyByScope(w, reqWithScopes([]string{"team.emails.view"}), "team.apikeys.manage") {
		t.Error("key scoped team.emails.view must be denied team.apikeys.manage")
	} else if w.Code != http.StatusForbidden {
		t.Errorf("want 403, got %d", w.Code)
	}

	// Org-level permission keys are unsatisfiable for API keys (team.* scopes
	// only), so org endpoints reject API keys.
	if !denyByScope(httptest.NewRecorder(), reqWithScopes([]string{"team.emails.view", "team.apikeys.manage"}), "org.teams.delete") {
		t.Error("API key must be denied an org.* permission key")
	}

	// A key holding the exact scope is allowed.
	if denyByScope(httptest.NewRecorder(), reqWithScopes([]string{"team.apikeys.manage"}), "team.apikeys.manage") {
		t.Error("key with team.apikeys.manage must be allowed that operation")
	}

	// Session/JWT auth is not scope-gated here (RBAC governs it).
	if denyByScope(httptest.NewRecorder(), reqWithJWT(), "org.teams.delete") {
		t.Error("JWT/session requests must not be denied by denyByScope")
	}
}

// TestRejectAPIKey guards the account self-service endpoints (no scope covers
// them) against API-key access.
func TestRejectAPIKey(t *testing.T) {
	if !rejectAPIKey(httptest.NewRecorder(), reqWithScopes([]string{"team.emails.view"})) {
		t.Error("API-key requests must be rejected on account endpoints")
	}
	if rejectAPIKey(httptest.NewRecorder(), reqWithJWT()) {
		t.Error("JWT/session requests must be allowed")
	}
}
