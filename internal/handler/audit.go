package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type AuditHandler struct{ svc *service.AuditService }

func NewAuditHandler(svc *service.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func (h *AuditHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)
		r.Get("/orgs/{orgId}/audit", h.List)
	})
}

func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	page, perPage := parsePagination(r)

	filter := domain.AuditFilter{}
	if v := r.URL.Query().Get("actor_id"); v != "" {
		id, _ := uuid.Parse(v)
		filter.ActorID = &id
	}
	if v := r.URL.Query().Get("action"); v != "" { filter.Action = &v }
	if v := r.URL.Query().Get("resource_type"); v != "" { filter.ResourceType = &v }
	if v := r.URL.Query().Get("date_from"); v != "" {
		t, _ := time.Parse(time.RFC3339, v)
		filter.DateFrom = &t
	}
	if v := r.URL.Query().Get("date_to"); v != "" {
		t, _ := time.Parse(time.RFC3339, v)
		filter.DateTo = &t
	}

	entries, total, err := h.svc.List(r.Context(), orgID, filter, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(entries, total, page, perPage))
}
