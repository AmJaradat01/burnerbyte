package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type AnalyticsHandler struct{ svc *service.AnalyticsService }

func NewAnalyticsHandler(svc *service.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{svc: svc}
}

func (h *AnalyticsHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)
		r.Get("/orgs/{orgId}/analytics", h.OrgAnalytics)
		r.Get("/teams/{teamId}/analytics", h.TeamAnalytics)
	})
}

func (h *AnalyticsHandler) OrgAnalytics(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	stats, err := h.svc.GetOrgAnalytics(r.Context(), orgID)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, stats)
}

func (h *AnalyticsHandler) TeamAnalytics(w http.ResponseWriter, r *http.Request) {
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	stats, err := h.svc.GetTeamAnalytics(r.Context(), teamID)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, stats)
}
