package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/middleware"
	"github.com/amjaradat01/burnerbyte/internal/service"
)

// TryHandler powers the public, unauthenticated "try it" demo inbox on the
// landing page. It is inert unless demo mode is enabled and configured with a
// provisioned demo assignment + user; otherwise every endpoint returns 404 and
// the frontend falls back to the simulated demo.
type TryHandler struct {
	inboxSvc     *service.InboxService
	emailSvc     *service.EmailService
	cfg          *config.Config
	assignmentID uuid.UUID
	userID       uuid.UUID
	ttl          time.Duration
	configured   bool // true when assignment_id and user_id are valid UUIDs
}

// NewTryHandler builds the handler from demo config. Misconfiguration (demo
// enabled but invalid IDs) disables the feature rather than failing startup.
func NewTryHandler(inboxSvc *service.InboxService, emailSvc *service.EmailService, appCfg *config.Config) *TryHandler {
	demoCfg := appCfg.Demo
	h := &TryHandler{inboxSvc: inboxSvc, emailSvc: emailSvc, cfg: appCfg, ttl: demoCfg.TTL}
	if h.ttl <= 0 {
		h.ttl = 10 * time.Minute
	}
	aID, err1 := uuid.Parse(demoCfg.AssignmentID)
	uID, err2 := uuid.Parse(demoCfg.UserID)
	if err1 != nil || err2 != nil {
		if demoCfg.Enabled {
			slog.Warn("demo mode enabled but demo.assignment_id/demo.user_id are not valid UUIDs; demo disabled")
		}
		return h
	}
	h.configured = true
	h.assignmentID = aID
	h.userID = uID
	if demoCfg.Enabled {
		slog.Info("demo (try-it) inbox enabled", "ttl", h.ttl.String())
	}
	return h
}

func (h *TryHandler) enabled() bool {
	return h.configured && h.cfg.DemoEnabled()
}

func (h *TryHandler) Routes(r chi.Router, rl *middleware.RateLimiter) {
	r.Get("/try/status", h.Status)
	r.With(rl.LoginLimiter).Post("/try/inbox", h.CreateInbox)
	r.With(rl.DemoLimiter).Get("/try/inbox/{inboxId}/emails", h.ListEmails)
}

// Status returns whether demo mode is enabled (public, unauthenticated).
func (h *TryHandler) Status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": h.enabled()})
}

// CreateInbox provisions a short-lived demo inbox under the configured demo
// assignment/user and returns its address and expiry.
func (h *TryHandler) CreateInbox(w http.ResponseWriter, r *http.Request) {
	if !h.enabled() {
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
	if !h.enabled() {
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
