package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// TestTryHandler_DisabledByDefault verifies the public demo endpoints are inert
// unless explicitly enabled — the off-by-default guarantee that keeps this from
// adding a live public attack surface to deployments that don't want it.
func TestTryHandler_DisabledByDefault(t *testing.T) {
	h := NewTryHandler(nil, nil, config.DemoConfig{}) // Enabled = false

	rec := httptest.NewRecorder()
	h.CreateInbox(rec, httptest.NewRequest(http.MethodPost, "/try/inbox", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("CreateInbox while disabled: want 404, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.ListEmails(rec, httptest.NewRequest(http.MethodGet, "/try/inbox/abc/emails", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("ListEmails while disabled: want 404, got %d", rec.Code)
	}
}

// TestTryHandler_InvalidConfigDisables verifies that enabling demo mode with
// bad IDs fails safe (disabled) rather than activating with garbage.
func TestTryHandler_InvalidConfigDisables(t *testing.T) {
	h := NewTryHandler(nil, nil, config.DemoConfig{Enabled: true, AssignmentID: "not-a-uuid", UserID: "nope"})

	rec := httptest.NewRecorder()
	h.CreateInbox(rec, httptest.NewRequest(http.MethodPost, "/try/inbox", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("CreateInbox with invalid demo config: want 404 (disabled), got %d", rec.Code)
	}
}
