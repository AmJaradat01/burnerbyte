package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

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

func (h *AnalyticsHandler) OrgAnalytics(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.analytics.view") {
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
	if checkOrgPermission(w, r, orgID, "org.analytics.view") {
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
	if checkOrgPermission(w, r, orgID, "org.analytics.view") {
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
	storagePerDay, err := h.svc.GetOrgStoragePerDay(r.Context(), orgID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"inboxes_per_day":  inboxes,
		"peak_hours":       peaks,
		"domain_breakdown": breakdown,
		"storage_per_day":  storagePerDay,
	})
}

func (h *AnalyticsHandler) OrgDomainTimeSeries(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org id")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.analytics.view") {
		return
	}
	domainName := r.URL.Query().Get("domain")
	if domainName == "" {
		writeError(w, http.StatusBadRequest, "domain query parameter required")
		return
	}
	days := h.defaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 && v <= 365 {
		days = v
	}
	data, err := h.svc.GetOrgDomainTimeSeries(r.Context(), orgID, domainName, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "domain": domainName})
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
	if checkTeamPermission(w, r, orgID, teamID, "team.analytics.view") {
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
	if checkTeamPermission(w, r, orgID, teamID, "team.analytics.view") {
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

func (h *AnalyticsHandler) TeamInsights(w http.ResponseWriter, r *http.Request) {
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
	if checkTeamPermission(w, r, orgID, teamID, "team.analytics.view") {
		return
	}
	days := h.defaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 && v <= 365 {
		days = v
	}
	inboxes, err := h.svc.GetTeamInboxesPerDay(r.Context(), teamID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	storage, err := h.svc.GetTeamStoragePerDay(r.Context(), teamID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"inboxes_per_day": inboxes,
		"storage_per_day": storage,
	})
}
