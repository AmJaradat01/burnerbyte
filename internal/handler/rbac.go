package handler

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/audit"
	"gitlab.com/amjaradat01/burnerbyte/internal/auth/rbac"
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

// checkOrgRole returns true if the RBAC check fails (and writes the error response).
func checkOrgRole(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, minRole string) bool {
	if err := RBAC.RequireOrgRole(r, orgID, minRole); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// checkTeamRole returns true if the RBAC check fails (and writes the error response).
func checkTeamRole(w http.ResponseWriter, r *http.Request, orgID, teamID uuid.UUID, minOrgFallback, minTeamRole string) bool {
	if err := RBAC.RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return true
	}
	return false
}

// auditRecord is a convenience wrapper for audit recording in handlers.
func auditRecord(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID) {
	if Audit != nil {
		Audit.RecordFromRequest(r, orgID, action, resourceType, resourceID, nil)
	}
}
