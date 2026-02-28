package handler

import (
	"net/http"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth/rbac"
)

// RBAC is the shared role checker, set during initialization.
var RBAC *rbac.Checker

func InitRBAC(c *rbac.Checker) { RBAC = c }

// checkOrgRole returns true if the RBAC check fails (and writes the error response).
// Usage: if checkOrgRole(w, r, orgID, rbac.OrgAdmin) { return }
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
