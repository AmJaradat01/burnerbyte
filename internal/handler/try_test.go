package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/config"
)

// TestTryHandler_DisabledByDefault verifies the public demo endpoints are inert
// unless explicitly enabled — the off-by-default guarantee that keeps this from
// adding a live public attack surface to deployments that don't want it.
func TestTryHandler_DisabledByDefault(t *testing.T) {
	h := NewTryHandler(nil, nil, &config.Config{}) // Demo.Enabled = false

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
	h := NewTryHandler(nil, nil, &config.Config{Demo: config.DemoConfig{Enabled: true, AssignmentID: "not-a-uuid", UserID: "nope"}})

	rec := httptest.NewRecorder()
	h.CreateInbox(rec, httptest.NewRequest(http.MethodPost, "/try/inbox", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("CreateInbox with invalid demo config: want 404 (disabled), got %d", rec.Code)
	}
}

// TestTryHandler_RuntimeToggle verifies that with valid demo IDs configured,
// the endpoints follow the runtime DemoEnabled() switch (the admin platform
// toggle) without a restart, and Status reports the live state.
func TestTryHandler_RuntimeToggle(t *testing.T) {
	cfg := &config.Config{Demo: config.DemoConfig{
		Enabled:      true,
		AssignmentID: uuid.New().String(),
		UserID:       uuid.New().String(),
	}}
	h := NewTryHandler(nil, nil, cfg)

	// Configured + enabled -> Status reports enabled.
	rec := httptest.NewRecorder()
	h.Status(rec, httptest.NewRequest(http.MethodGet, "/try/status", nil))
	if !strings.Contains(rec.Body.String(), `"enabled":true`) {
		t.Fatalf("Status should report enabled=true, got %s", rec.Body.String())
	}

	// Admin turns it off at runtime (same path UpdatePlatformSettings uses).
	cfg.WriteLocked(func(c *config.Config) { c.Demo.Enabled = false })

	rec = httptest.NewRecorder()
	h.Status(rec, httptest.NewRequest(http.MethodGet, "/try/status", nil))
	if !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Errorf("Status should report enabled=false after toggle-off, got %s", rec.Body.String())
	}
	// And the endpoints are gated off even though IDs remain configured.
	rec = httptest.NewRecorder()
	h.CreateInbox(rec, httptest.NewRequest(http.MethodPost, "/try/inbox", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("CreateInbox after toggle-off: want 404, got %d", rec.Code)
	}

	// DemoConfigured reflects that IDs are present.
	if !cfg.DemoConfigured() {
		t.Error("DemoConfigured should be true when assignment/user IDs are set")
	}
}
