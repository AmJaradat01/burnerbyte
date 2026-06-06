package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/audit"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
)

// RBAC is the shared role checker, set during initialization.
var RBAC *rbac.Checker

func InitRBAC(c *rbac.Checker) { RBAC = c }

// Audit is the shared audit recorder for all handlers.
var Audit *audit.Recorder

func InitAudit(rec *audit.Recorder) { Audit = rec }

// WebhookDispatch is the shared webhook dispatcher for all handlers.
var WebhookDispatch webhookDispatcher

type webhookDispatcher interface {
	Dispatch(ctx context.Context, teamID uuid.UUID, event string, data any)
}

func InitWebhookDispatch(d webhookDispatcher) { WebhookDispatch = d }

// denyByScope returns true (and writes 403) when the request is authenticated
// with an API key whose scopes do not include permissionKey. It is a no-op for
// JWT/session auth. API-key scopes share the same keys as RBAC permissions, so
// this confines a key to exactly what it was granted. Keys only ever hold
// team.* scopes, so any org.* permissionKey is unsatisfiable and org-level
// endpoints reject API keys outright.
func denyByScope(w http.ResponseWriter, r *http.Request, permissionKey string) bool {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), permissionKey) {
		writeError(w, http.StatusForbidden, "API key is missing the required scope: "+permissionKey)
		return true
	}
	return false
}

// rejectAPIKey returns true (and writes 403) for any API-key-authenticated
// request. Used on endpoints no API-key scope covers (account self-service),
// so a leaked or narrowly-scoped key cannot reach them.
func rejectAPIKey(w http.ResponseWriter, r *http.Request) bool {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 {
		writeError(w, http.StatusForbidden, "this endpoint cannot be accessed with an API key")
		return true
	}
	return false
}

// checkOrgPermission returns true if the permission check fails (and writes the error response).
func checkOrgPermission(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, permissionKey string) bool {
	if RBAC == nil {
		writeError(w, http.StatusInternalServerError, "RBAC not initialized")
		return true
	}
	if denyByScope(w, r, permissionKey) {
		return true
	}
	if err := RBAC.RequireOrgPermission(r, orgID, permissionKey); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// checkTeamPermission returns true if the permission check fails (and writes the error response).
func checkTeamPermission(w http.ResponseWriter, r *http.Request, orgID, teamID uuid.UUID, permissionKey string) bool {
	if RBAC == nil {
		writeError(w, http.StatusInternalServerError, "RBAC not initialized")
		return true
	}
	if denyByScope(w, r, permissionKey) {
		return true
	}
	if err := RBAC.RequireTeamPermission(r, orgID, teamID, permissionKey); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// checkOrgRankAbove returns true if the rank check fails (and writes the error response).
// Used for self-protection on org role change operations.
func checkOrgRankAbove(w http.ResponseWriter, r *http.Request, orgID, targetUserID uuid.UUID) bool {
	if RBAC == nil {
		writeError(w, http.StatusInternalServerError, "RBAC not initialized")
		return true
	}
	if err := RBAC.RequireRankAbove(r, orgID, targetUserID); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// checkTeamRankAbove returns true if the rank check fails (and writes the error response).
// Used for self-protection on team role change operations.
func checkTeamRankAbove(w http.ResponseWriter, r *http.Request, teamID, targetUserID uuid.UUID) bool {
	if RBAC == nil {
		writeError(w, http.StatusInternalServerError, "RBAC not initialized")
		return true
	}
	if err := RBAC.RequireTeamRankAbove(r, teamID, targetUserID); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// auditRecord is a convenience wrapper for audit recording in handlers.
func auditRecord(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, meta map[string]any) {
	if Audit != nil {
		Audit.RecordFromRequest(r, orgID, action, resourceType, resourceID, meta)
	}
}

// auditRecordEnhanced is a convenience wrapper for enhanced audit recording in handlers.
func auditRecordEnhanced(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, meta map[string]any) {
	if Audit != nil {
		Audit.RecordEnhanced(r, orgID, action, resourceType, resourceID, resourceName, meta)
	}
}

// writeServiceError maps common service-layer error messages to appropriate HTTP status codes.
// It checks for known error patterns (forbidden, not found, conflict) and falls back to 400
// for validation-like errors. Use this instead of writeError(w, http.StatusBadRequest, err.Error()).
func writeServiceError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "forbidden"):
		writeError(w, http.StatusForbidden, msg)
	case strings.Contains(msg, "not found"):
		writeError(w, http.StatusNotFound, msg)
	case strings.Contains(msg, "already taken") || strings.Contains(msg, "already exists") || strings.Contains(msg, "already assigned") || strings.Contains(msg, "already linked"):
		writeError(w, http.StatusConflict, msg)
	case strings.Contains(msg, "cannot lock") || strings.Contains(msg, "cannot unlink") || strings.Contains(msg, "must re-authenticate") || strings.Contains(msg, "must set a password"):
		writeError(w, http.StatusForbidden, msg)
	case strings.Contains(msg, "locked to SSO") || strings.Contains(msg, "locked to password"):
		writeError(w, http.StatusForbidden, msg)
	default:
		writeError(w, http.StatusBadRequest, msg)
	}
}
