package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

var validSeverities = map[string]bool{
	"info":     true,
	"warning":  true,
	"critical": true,
}

var validCategories = map[string]bool{
	"auth":    true,
	"org":     true,
	"team":    true,
	"domain":  true,
	"inbox":   true,
	"email":   true,
	"webhook": true,
	"apikey":  true,
	"admin":   true,
	"member":  true,
}

type AuditHandler struct{ svc *service.AuditService }

func NewAuditHandler(svc *service.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

// parseAuditFilter parses common audit filter query parameters from the request.
// Returns the filter and true if valid, or writes an error response and returns false.
func parseAuditFilter(w http.ResponseWriter, r *http.Request) (domain.AuditFilter, bool) {
	filter := domain.AuditFilter{}

	if v := r.URL.Query().Get("actor_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid actor_id")
			return filter, false
		}
		filter.ActorID = &id
	}
	if v := r.URL.Query().Get("action"); v != "" {
		filter.Action = &v
	}
	if v := r.URL.Query().Get("actor_email"); v != "" {
		filter.ActorEmail = &v
	}
	if v := r.URL.Query().Get("resource_type"); v != "" {
		filter.ResourceType = &v
	}
	if v := r.URL.Query().Get("date_from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date_from, use RFC3339 format")
			return filter, false
		}
		filter.DateFrom = &t
	}
	if v := r.URL.Query().Get("date_to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date_to, use RFC3339 format")
			return filter, false
		}
		filter.DateTo = &t
	}
	if v := r.URL.Query().Get("severity"); v != "" {
		if !validSeverities[v] {
			writeError(w, http.StatusBadRequest, "invalid severity: must be info, warning, or critical")
			return filter, false
		}
		filter.Severity = &v
	}
	if v := r.URL.Query().Get("category"); v != "" {
		if !validCategories[v] {
			writeError(w, http.StatusBadRequest, "invalid category: must be one of auth, org, team, domain, inbox, email, webhook, apikey, admin, member")
			return filter, false
		}
		filter.Category = &v
	}
	if v := r.URL.Query().Get("resource_name"); v != "" {
		filter.ResourceName = &v
	}

	return filter, true
}

func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.audit.view") {
		return
	}
	page, perPage := parsePagination(r)

	filter, ok := parseAuditFilter(w, r)
	if !ok {
		return
	}

	entries, total, err := h.svc.List(r.Context(), orgID, filter, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(entries, total, page, perPage))
}

// ListPlatform returns platform-level audit events (no owning org) such as
// registration, login, password reset, and session revocation. System-admin
// only; the route is guarded by auth.RequireSystemAdmin.
func (h *AuditHandler) ListPlatform(w http.ResponseWriter, r *http.Request) {
	page, perPage := parsePagination(r)
	filter, ok := parseAuditFilter(w, r)
	if !ok {
		return
	}
	entries, total, err := h.svc.ListPlatform(r.Context(), filter, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(entries, total, page, perPage))
}

func (h *AuditHandler) Export(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.audit.export") {
		return
	}

	format := r.URL.Query().Get("format")
	if format != "csv" && format != "json" {
		writeError(w, http.StatusBadRequest, "format is required and must be csv or json")
		return
	}

	filter, ok := parseAuditFilter(w, r)
	if !ok {
		return
	}

	entries, err := h.svc.ListAll(r.Context(), orgID, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}

	const maxExportRows = 10000
	if len(entries) >= maxExportRows {
		w.Header().Set("X-Truncated", "true")
	}

	timestamp := time.Now().UTC().Format("20060102_150405")

	switch format {
	case "csv":
		filename := fmt.Sprintf("audit_export_%s.csv", timestamp)
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.WriteHeader(http.StatusOK)

		cw := csv.NewWriter(w)
		// Write header row
		cw.Write([]string{
			"id", "created_at", "org_id", "actor_id", "actor_email", "actor_display_name",
			"action", "severity", "category", "resource_type", "resource_id", "resource_name",
			"ip_address", "user_agent", "metadata",
		})

		for _, e := range entries {
			actorID := ""
			if e.ActorID != nil {
				actorID = e.ActorID.String()
			}
			ipAddress := ""
			if e.IPAddress != nil {
				ipAddress = *e.IPAddress
			}
			metaJSON, _ := json.Marshal(e.Metadata)

			cw.Write([]string{
				e.ID.String(),
				e.CreatedAt.UTC().Format(time.RFC3339),
				e.OrgID.String(),
				actorID,
				e.ActorEmail,
				e.ActorDisplayName,
				e.Action,
				e.Severity,
				e.Category,
				e.ResourceType,
				e.ResourceID.String(),
				e.ResourceName,
				ipAddress,
				e.UserAgent,
				string(metaJSON),
			})
		}
		cw.Flush()

	case "json":
		filename := fmt.Sprintf("audit_export_%s.json", timestamp)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.WriteHeader(http.StatusOK)
		if entries == nil {
			entries = []domain.AuditEntry{}
		}
		json.NewEncoder(w).Encode(entries)
	}
}
