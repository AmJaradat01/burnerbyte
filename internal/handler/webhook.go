package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type WebhookHandler struct {
	svc *service.WebhookService
}

func NewWebhookHandler(svc *service.WebhookService) *WebhookHandler {
	return &WebhookHandler{svc: svc}
}

func (h *WebhookHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "team.webhooks.manage") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid org ID"); return }
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid team ID"); return }
	if checkTeamPermission(w, r, orgID, teamID, "team.webhooks.manage") {
		return
	}
	var input domain.CreateWebhookInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body"); return
	}
	wh, err := h.svc.Create(r.Context(), teamID, uc.UserID, input)
	if err != nil { writeServiceError(w, err); return }
	auditRecordEnhanced(r, orgID, "webhook.created", "webhook", wh.ID, input.URL, map[string]any{"url": input.URL})
	writeJSON(w, http.StatusCreated, wh)
}

func (h *WebhookHandler) List(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "team.webhooks.view") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid org ID"); return }
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid team ID"); return }
	if checkTeamPermission(w, r, orgID, teamID, "team.webhooks.view") {
		return
	}
	page, perPage := parsePagination(r)
	webhooks, total, err := h.svc.List(r.Context(), teamID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(webhooks, total, page, perPage))
}

func (h *WebhookHandler) Update(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "team.webhooks.manage") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid org ID"); return }
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid team ID"); return }
	if checkTeamPermission(w, r, orgID, teamID, "team.webhooks.manage") {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid webhook ID"); return }

	// Fetch webhook before update for diff
	beforeWh, _ := h.svc.GetByID(r.Context(), teamID, id)

	var input domain.UpdateWebhookInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body"); return
	}
	wh, err := h.svc.Update(r.Context(), teamID, id, input)
	if err != nil { writeServiceError(w, err); return }

	meta := map[string]any{"url": input.URL, "events": input.Events, "active": input.Active}
	if beforeWh != nil {
		meta["before"] = map[string]any{"url": beforeWh.URL, "events": beforeWh.Events, "active": beforeWh.Active}
		meta["after"] = map[string]any{"url": wh.URL, "events": wh.Events, "active": wh.Active}
	}
	auditRecordEnhanced(r, orgID, "webhook.updated", "webhook", id, wh.URL, meta)
	writeJSON(w, http.StatusOK, wh)
}

func (h *WebhookHandler) Delete(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "team.webhooks.manage") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid org ID"); return }
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid team ID"); return }
	if checkTeamPermission(w, r, orgID, teamID, "team.webhooks.manage") {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid webhook ID"); return }

	// Fetch webhook before deletion for audit
	webhookURL := ""
	resourceName := id.String()
	if wh, err := h.svc.GetByID(r.Context(), teamID, id); err == nil && wh != nil {
		webhookURL = wh.URL
		resourceName = wh.URL
	}

	if err := h.svc.Delete(r.Context(), teamID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed"); return
	}
	auditRecordEnhanced(r, orgID, "webhook.deleted", "webhook", id, resourceName, map[string]any{"webhook_id": id.String(), "webhook_url": webhookURL})
	w.WriteHeader(http.StatusNoContent)
}

func (h *WebhookHandler) ListDeliveryLogs(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "team.webhooks.view") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid org ID"); return }
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid team ID"); return }
	if checkTeamPermission(w, r, orgID, teamID, "team.webhooks.view") {
		return
	}
	webhookID, err := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err != nil { writeError(w, http.StatusBadRequest, "invalid webhook ID"); return }
	page, perPage := parsePagination(r)
	logs, total, err := h.svc.ListDeliveryLogs(r.Context(), teamID, webhookID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(logs, total, page, perPage))
}
