package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/middleware"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

// TryHandler powers the public, unauthenticated "try it" demo inbox on the
// landing page. It is inert unless demo mode is enabled and configured with a
// provisioned demo assignment + user; otherwise every endpoint returns 404 and
// the frontend falls back to the simulated demo.
type TryHandler struct {
	inboxSvc     *service.InboxService
	emailSvc     *service.EmailService
	enabled      bool
	assignmentID uuid.UUID
	userID       uuid.UUID
	ttl          time.Duration
}

// NewTryHandler builds the handler from demo config. Misconfiguration (demo
// enabled but invalid IDs) disables the feature rather than failing startup.
func NewTryHandler(inboxSvc *service.InboxService, emailSvc *service.EmailService, cfg config.DemoConfig) *TryHandler {
	h := &TryHandler{inboxSvc: inboxSvc, emailSvc: emailSvc, ttl: cfg.TTL}
	if h.ttl <= 0 {
		h.ttl = 10 * time.Minute
	}
	if !cfg.Enabled {
		return h
	}
	aID, err1 := uuid.Parse(cfg.AssignmentID)
	uID, err2 := uuid.Parse(cfg.UserID)
	if err1 != nil || err2 != nil {
		slog.Warn("demo mode enabled but demo.assignment_id/demo.user_id are not valid UUIDs; demo disabled")
		return h
	}
	h.enabled = true
	h.assignmentID = aID
	h.userID = uID
	slog.Info("demo (try-it) inbox enabled", "ttl", h.ttl.String())
	return h
}

func (h *TryHandler) Routes(r chi.Router, rl *middleware.RateLimiter) {
	// Create is strict (LoginLimiter, ~5/min/IP); polling for mail is lenient.
	r.With(rl.LoginLimiter).Post("/try/inbox", h.CreateInbox)
	r.With(rl.DemoLimiter).Get("/try/inbox/{inboxId}/emails", h.ListEmails)
}

// CreateInbox provisions a short-lived demo inbox under the configured demo
// assignment/user and returns its address and expiry.
func (h *TryHandler) CreateInbox(w http.ResponseWriter, r *http.Request) {
	if !h.enabled {
		writeError(w, http.StatusNotFound, "demo mode is not enabled")
		return
	}
	ttlStr := h.ttl.String()
	inbox, err := h.inboxSvc.CreateInboxByAssignment(r.Context(), h.assignmentID, h.userID, domain.CreateInboxInput{TTL: &ttlStr})
	if err != nil {
		slog.Error("demo inbox creation failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not create a demo inbox right now")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"inbox_id":   inbox.ID,
		"address":    inbox.FullAddress,
		"expires_at": inbox.ExpiresAt,
	})
}

// ListEmails returns the demo inbox's messages. Scoped to the demo user, so a
// non-demo inbox id (e.g. a real user's) can't be read here — ListByInbox
// rejects any inbox the demo user doesn't own.
func (h *TryHandler) ListEmails(w http.ResponseWriter, r *http.Request) {
	if !h.enabled {
		writeError(w, http.StatusNotFound, "demo mode is not enabled")
		return
	}
	inboxID, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox id")
		return
	}
	emails, total, err := h.emailSvc.ListByInbox(r.Context(), inboxID, h.userID, 1, 50)
	if err != nil {
		// Unknown / non-demo / expired inbox — don't distinguish.
		writeError(w, http.StatusNotFound, "demo inbox not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"emails": emails, "total": total})
}
