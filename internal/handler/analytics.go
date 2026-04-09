package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type AnalyticsHandler struct {
	svc         *service.AnalyticsService
	defaultDays int
}

func NewAnalyticsHandler(svc *service.AnalyticsService, defaultDays int) *AnalyticsHandler {
	if defaultDays <= 0 {
		defaultDays = 30
	}
	return &AnalyticsHandler{svc: svc, defaultDays: defaultDays}
}

func (h *AnalyticsHandler) Routes(r chi.Router) {
		r.Get("/orgs/{orgId}/analytics", h.OrgAnalytics)
		r.Get("/orgs/{orgId}/analytics/emails-per-day", h.OrgEmailsPerDay)
		r.Get("/orgs/{orgId}/teams/{teamId}/analytics", h.TeamAnalytics)
		r.Get("/orgs/{orgId}/teams/{teamId}/analytics/emails-per-day", h.TeamEmailsPerDay)
}

func (h *AnalyticsHandler) OrgAnalytics(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}
	stats, err := h.svc.GetOrgAnalytics(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *AnalyticsHandler) OrgEmailsPerDay(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}
	days := h.defaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 && v <= 365 {
		days = v
	}
	data, err := h.svc.GetOrgEmailsPerDay(r.Context(), orgID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func (h *AnalyticsHandler) OrgInsights(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}
	days := h.defaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 && v <= 365 {
		days = v
	}
	inboxes, err := h.svc.GetOrgInboxesPerDay(r.Context(), orgID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	peaks, err := h.svc.GetOrgPeakHours(r.Context(), orgID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	breakdown, err := h.svc.GetOrgDomainBreakdown(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"inboxes_per_day":  inboxes,
		"peak_hours":       peaks,
		"domain_breakdown": breakdown,
	})
}

func (h *AnalyticsHandler) TeamAnalytics(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team id")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	stats, err := h.svc.GetTeamAnalytics(r.Context(), teamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *AnalyticsHandler) TeamEmailsPerDay(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team id")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	days := h.defaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 && v <= 365 {
		days = v
	}
	data, err := h.svc.GetTeamEmailsPerDay(r.Context(), teamID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}
