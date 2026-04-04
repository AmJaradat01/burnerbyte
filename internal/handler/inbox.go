package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type InboxHandler struct {
	svc *service.InboxService
}

func NewInboxHandler(svc *service.InboxService) *InboxHandler {
	return &InboxHandler{svc: svc}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (h *InboxHandler) Routes(r chi.Router) {
		// User-scoped
		r.Get("/inboxes", h.ListMyInboxes)
		r.Post("/inboxes", h.CreateInboxFlat)
		r.Get("/inboxes/{inboxId}", h.GetInbox)
		r.Delete("/inboxes/{inboxId}", h.DeleteInbox)
		r.Post("/inboxes/{inboxId}/extend", h.ExtendTTL)
		// Team-scoped
		r.Get("/orgs/{orgId}/teams/{teamId}/inboxes", h.ListInboxes)
}

func (h *InboxHandler) CreateInboxFlat(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "inbox:write") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	var input struct {
		DomainAssignmentID string `json:"domain_assignment_id"`
		Alias              string `json:"alias,omitempty"`
		TTL                string `json:"ttl,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	assignmentID, err := uuid.Parse(input.DomainAssignmentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain_assignment_id")
		return
	}
	inbox, err := h.svc.CreateInboxByAssignment(r.Context(), assignmentID, uc.UserID, domain.CreateInboxInput{
		CustomAlias: strPtr(input.Alias),
		TTL:         strPtr(input.TTL),
	})
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "already taken") {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	if WebhookDispatch != nil {
		WebhookDispatch.Dispatch(r.Context(), inbox.TeamID, "inbox.created", map[string]any{
			"inbox_id": inbox.ID, "address": inbox.Address, "domain_assignment_id": assignmentID,
		})
	}
	auditRecord(r, inbox.OrgID, "inbox.created", "inbox", inbox.ID, map[string]any{"address": inbox.FullAddress, "expires_at": inbox.ExpiresAt.String()})
	writeJSON(w, http.StatusCreated, inbox)
}

func (h *InboxHandler) ListMyInboxes(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	page, perPage := parsePagination(r)
	status := r.URL.Query().Get("status")
	if status == "" { status = "active" }
	inboxes, total, err := h.svc.ListByUserWithStatus(r.Context(), uc.UserID, status, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list inboxes")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(inboxes, total, page, perPage))
}

func (h *InboxHandler) ListInboxes(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	page, perPage := parsePagination(r)
	status := r.URL.Query().Get("status")
	if status == "" { status = "active" }
	inboxes, total, err := h.svc.ListByTeamWithStatus(r.Context(), teamID, uc.UserID, status, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list inboxes")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(inboxes, total, page, perPage))
}

func (h *InboxHandler) GetInbox(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	inbox, err := h.svc.GetInbox(r.Context(), id, uc.UserID)
	if err != nil {
		if err.Error() == "forbidden: not your inbox" {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		writeError(w, http.StatusNotFound, "inbox not found")
		return
	}
	writeJSON(w, http.StatusOK, inbox)
}

func (h *InboxHandler) ExtendTTL(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	var body struct {
		Duration string `json:"duration"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	inbox, err := h.svc.ExtendTTL(r.Context(), id, uc.UserID, body.Duration)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecord(r, inbox.OrgID, "inbox.extended", "inbox", id, map[string]any{"address": inbox.FullAddress, "new_expires_at": inbox.ExpiresAt.String()})
	writeJSON(w, http.StatusOK, inbox)
}

func (h *InboxHandler) DeleteInbox(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "inbox:write") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	inbox, err := h.svc.GetInbox(r.Context(), id, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.DeleteInbox(r.Context(), id, uc.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecord(r, inbox.OrgID, "inbox.deleted", "inbox", id, map[string]any{"address": inbox.FullAddress})
	writeJSON(w, http.StatusOK, map[string]string{"message": "inbox deleted"})
}
