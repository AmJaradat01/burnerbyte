package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type TeamHandler struct {
	svc *service.TeamService
}

func NewTeamHandler(svc *service.TeamService) *TeamHandler {
	return &TeamHandler{svc: svc}
}

func (h *TeamHandler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.teams.create") {
		return
	}
	var input domain.CreateTeamInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := h.svc.CreateTeam(r.Context(), orgID, input, uc.UserID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "team.created", "team", result.Team.ID, result.Team.Name, map[string]any{"name": result.Team.Name})
	writeJSON(w, http.StatusCreated, result)
}

func (h *TeamHandler) ListTeams(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.view") {
		return
	}

	uc := auth.GetUser(r.Context())
	page, perPage := parsePagination(r)
	opts := postgres.ListTeamsOpts{
		Page:    page,
		PerPage: perPage,
		Search:  r.URL.Query().Get("search"),
	}
	if isArchivedStr := r.URL.Query().Get("is_archived"); isArchivedStr != "" {
		val, err := strconv.ParseBool(isArchivedStr)
		if err == nil {
			opts.IsArchived = &val
		}
	}

	// Check if user is admin/owner using permission cache rank instead of hardcoded role string comparison
	isAdmin := uc.IsSystemAdmin
	if !isAdmin && RBAC != nil && RBAC.Cache() != nil {
		membership, err := RBAC.GetOrgRole(r.Context(), uc.UserID, orgID)
		if err == nil {
			rank := RBAC.Cache().GetRank(membership)
			if rank >= 2 { // admin rank or higher
				isAdmin = true
			}
		}
	}

	if isAdmin {
		// Admins see all teams
		teams, total, err := h.svc.ListByOrg(r.Context(), orgID, opts)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list teams")
			return
		}
		writeJSON(w, http.StatusOK, paginatedResponse(teams, total, page, perPage))
	} else {
		// Normal members see only their teams
		teams, total, err := h.svc.ListByUserMembership(r.Context(), orgID, uc.UserID, opts)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list teams")
			return
		}
		writeJSON(w, http.StatusOK, paginatedResponse(teams, total, page, perPage))
	}
}

func (h *TeamHandler) GetTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, id, "team.view") {
		return
	}
	detail, err := h.svc.GetTeamDetail(r.Context(), orgID, id)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "team not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get team")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *TeamHandler) UpdateTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, id, "team.settings.manage") {
		return
	}
	beforeTeam, _ := h.svc.GetTeam(r.Context(), orgID, id)

	var input domain.UpdateTeamInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	team, err := h.svc.UpdateTeam(r.Context(), orgID, id, input)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	meta := map[string]any{"name": input.Name}
	if beforeTeam != nil {
		meta["before"] = map[string]any{"name": beforeTeam.Name}
		meta["after"] = map[string]any{"name": team.Name}
	}
	auditRecordEnhanced(r, orgID, "team.updated", "team", id, team.Name, meta)
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamHandler) DeleteTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.teams.delete") {
		return
	}
	beforeTeam, _ := h.svc.GetTeam(r.Context(), orgID, id)
	teamName := ""
	if beforeTeam != nil {
		teamName = beforeTeam.Name
	}
	if err := h.svc.DeleteTeam(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete team")
		return
	}
	auditRecordEnhanced(r, orgID, "team.deleted", "team", id, teamName, map[string]any{"team_id": id.String(), "name": teamName})
	w.WriteHeader(http.StatusNoContent)
}

func (h *TeamHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.manage") {
		return
	}
	var input domain.AddTeamMemberInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.svc.AddMember(r.Context(), teamID, input); err != nil {
		status := http.StatusBadRequest
		if err.Error() == "user already a member" {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.member_added", "team", teamID, teamName, map[string]any{
		"target_user_email": input.Email,
		"target_user_id":    input.UserID,
		"team_name":         teamName,
		"role":              input.Role,
	})
	writeJSON(w, http.StatusCreated, map[string]string{"message": "member added"})
}

func (h *TeamHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.view") {
		return
	}
	page, perPage := parsePagination(r)
	opts := postgres.ListMembersOpts{
		Page:    page,
		PerPage: perPage,
		Search:  r.URL.Query().Get("search"),
		Role:    r.URL.Query().Get("role"),
	}
	members, total, err := h.svc.ListMembers(r.Context(), teamID, opts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(members, total, page, perPage))
}

func (h *TeamHandler) ChangeRole(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.role") {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	// Self-protection: prevent modifying users at the same or higher rank
	if checkTeamRankAbove(w, r, teamID, userID) {
		return
	}
	var input domain.ChangeTeamRoleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	oldRole := ""
	if membership, err := h.svc.GetMembership(r.Context(), userID, teamID); err == nil {
		oldRole = membership.Role
	}
	if err := h.svc.ChangeRole(r.Context(), teamID, userID, input.Role); err != nil {
		writeServiceError(w, err)
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.member_role_changed", "team", teamID, teamName, map[string]any{
		"target_user_id": userID.String(),
		"team_name":      teamName,
		"old_role":       oldRole,
		"new_role":       input.Role,
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "role updated"})
}

func (h *TeamHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.manage") {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	if err := h.svc.RemoveMember(r.Context(), teamID, userID); err != nil {
		writeServiceError(w, err)
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.member_removed", "team", teamID, teamName, map[string]any{
		"target_user_id": userID.String(),
		"team_name":      teamName,
	})
	w.WriteHeader(http.StatusNoContent)
}

// ── New endpoints ──

func (h *TeamHandler) ArchiveTeam(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.teams.manage") {
		return
	}
	team, err := h.svc.ArchiveTeam(r.Context(), orgID, teamID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "team not found")
			return
		}
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "team.archived", "team", teamID, team.Name, map[string]any{"team_name": team.Name})
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamHandler) RestoreTeam(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.teams.manage") {
		return
	}
	team, err := h.svc.RestoreTeam(r.Context(), orgID, teamID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "team not found")
			return
		}
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "team.restored", "team", teamID, team.Name, map[string]any{"team_name": team.Name})
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamHandler) GetImpact(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.teams.manage") {
		return
	}
	impact, err := h.svc.GetImpact(r.Context(), orgID, teamID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "team not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get impact")
		return
	}
	writeJSON(w, http.StatusOK, impact)
}

func (h *TeamHandler) LeaveTeam(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.view") {
		return
	}
	uc := auth.GetUser(r.Context())
	if err := h.svc.LeaveTeam(r.Context(), orgID, teamID, uc.UserID); err != nil {
		writeServiceError(w, err)
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.member_left", "team", teamID, teamName, map[string]any{
		"user_id":   uc.UserID.String(),
		"team_name": teamName,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *TeamHandler) BulkAddMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.manage") {
		return
	}
	var input domain.BulkAddMembersInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := h.svc.BulkAddMembers(r.Context(), teamID, input.Members)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.members_bulk_added", "team", teamID, teamName, map[string]any{
		"team_name":   teamName,
		"added_count": result.AddedCount,
	})
	writeJSON(w, http.StatusOK, result)
}

func (h *TeamHandler) BulkRemoveMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.members.manage") {
		return
	}
	var input domain.BulkRemoveMembersInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := h.svc.BulkRemoveMembers(r.Context(), teamID, input.UserIDs)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	teamName := ""
	if team, err := h.svc.GetTeam(r.Context(), orgID, teamID); err == nil {
		teamName = team.Name
	}
	auditRecordEnhanced(r, orgID, "team.members_bulk_removed", "team", teamID, teamName, map[string]any{
		"team_name":     teamName,
		"removed_count": result.RemovedCount,
	})
	writeJSON(w, http.StatusOK, result)
}

func (h *TeamHandler) TransferTeam(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	// System admin check is done via middleware in route registration
	var input domain.TransferTeamInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := h.svc.TransferTeam(r.Context(), orgID, teamID, input.TargetOrgID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	// Audit in source org
	teamName := ""
	if result.Team != nil {
		teamName = result.Team.Name
	}
	auditRecordEnhanced(r, orgID, "team.transferred", "team", teamID, teamName, map[string]any{
		"team_name":     teamName,
		"source_org_id": orgID.String(),
		"target_org_id": input.TargetOrgID.String(),
	})
	// Audit in target org
	auditRecordEnhanced(r, input.TargetOrgID, "team.transferred", "team", teamID, teamName, map[string]any{
		"team_name":     teamName,
		"source_org_id": orgID.String(),
		"target_org_id": input.TargetOrgID.String(),
	})
	writeJSON(w, http.StatusOK, result)
}
