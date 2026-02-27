package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type WebhookHandler struct {
	svc *service.WebhookService
}

func NewWebhookHandler(svc *service.WebhookService) *WebhookHandler {
	return &WebhookHandler{svc: svc}
}

func (h *WebhookHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)
		r.Post("/orgs/{orgId}/teams/{teamId}/webhooks", h.Create)
		r.Get("/orgs/{orgId}/teams/{teamId}/webhooks", h.List)
		r.Patch("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", h.Update)
		r.Delete("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", h.Delete)
	})
}

func (h *WebhookHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	var input domain.CreateWebhookInput
	json.NewDecoder(r.Body).Decode(&input)
	wh, err := h.svc.Create(r.Context(), teamID, uc.UserID, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, wh)
}

func (h *WebhookHandler) List(w http.ResponseWriter, r *http.Request) {
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	page, perPage := parsePagination(r)
	webhooks, total, err := h.svc.List(r.Context(), teamID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(webhooks, total, page, perPage))
}

func (h *WebhookHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(chi.URLParam(r, "webhookId"))
	var input domain.UpdateWebhookInput
	json.NewDecoder(r.Body).Decode(&input)
	wh, err := h.svc.Update(r.Context(), id, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusOK, wh)
}

func (h *WebhookHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed"); return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "webhook deleted"})
}
