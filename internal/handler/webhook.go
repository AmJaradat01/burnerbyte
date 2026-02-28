package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/auth/rbac"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type WebhookHandler struct {
	svc *service.WebhookService
}

func NewWebhookHandler(svc *service.WebhookService) *WebhookHandler {
	return &WebhookHandler{svc: svc}
}

func (h *WebhookHandler) Routes(r chi.Router) {
		r.Post("/orgs/{orgId}/teams/{teamId}/webhooks", h.Create)
		r.Get("/orgs/{orgId}/teams/{teamId}/webhooks", h.List)
		r.Patch("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", h.Update)
		r.Delete("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", h.Delete)
		r.Get("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}/deliveries", h.ListDeliveryLogs)
}

func (h *WebhookHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	var input domain.CreateWebhookInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body"); return
	}
	wh, err := h.svc.Create(r.Context(), teamID, uc.UserID, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	auditRecord(r, orgID, "webhook.created", "webhook", wh.ID)
	writeJSON(w, http.StatusCreated, wh)
}

func (h *WebhookHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	page, perPage := parsePagination(r)
	webhooks, total, err := h.svc.List(r.Context(), teamID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(webhooks, total, page, perPage))
}

func (h *WebhookHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	id, _ := uuid.Parse(chi.URLParam(r, "webhookId"))
	var input domain.UpdateWebhookInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body"); return
	}
	wh, err := h.svc.Update(r.Context(), teamID, id, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusOK, wh)
}

func (h *WebhookHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	id, _ := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err := h.svc.Delete(r.Context(), teamID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed"); return
	}
	auditRecord(r, orgID, "webhook.deleted", "webhook", id)
	writeJSON(w, http.StatusOK, map[string]string{"message": "webhook deleted"})
}

func (h *WebhookHandler) ListDeliveryLogs(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	webhookID, _ := uuid.Parse(chi.URLParam(r, "webhookId"))
	page, perPage := parsePagination(r)
	logs, total, err := h.svc.ListDeliveryLogs(r.Context(), teamID, webhookID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(logs, total, page, perPage))
}
