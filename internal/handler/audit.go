package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type AuditHandler struct{ svc *service.AuditService }

func NewAuditHandler(svc *service.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func (h *AuditHandler) Routes(r chi.Router) {
		r.Get("/orgs/{orgId}/audit", h.List)
}

func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	page, perPage := parsePagination(r)

	filter := domain.AuditFilter{}
	if v := r.URL.Query().Get("actor_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid actor_id")
			return
		}
		filter.ActorID = &id
	}
	if v := r.URL.Query().Get("action"); v != "" { filter.Action = &v }
	if v := r.URL.Query().Get("resource_type"); v != "" { filter.ResourceType = &v }
	if v := r.URL.Query().Get("date_from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date_from, use RFC3339 format")
			return
		}
		filter.DateFrom = &t
	}
	if v := r.URL.Query().Get("date_to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date_to, use RFC3339 format")
			return
		}
		filter.DateTo = &t
	}

	entries, total, err := h.svc.List(r.Context(), orgID, filter, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(entries, total, page, perPage))
}
