package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
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

func (h *TeamHandler) Routes(r chi.Router) {

		r.Post("/orgs/{orgId}/teams", h.CreateTeam)
		r.Get("/orgs/{orgId}/teams", h.ListTeams)
		r.Get("/orgs/{orgId}/teams/{teamId}", h.GetTeam)
		r.Patch("/orgs/{orgId}/teams/{teamId}", h.UpdateTeam)
		r.Delete("/orgs/{orgId}/teams/{teamId}", h.DeleteTeam)
		r.Post("/orgs/{orgId}/teams/{teamId}/members", h.AddMember)
		r.Get("/orgs/{orgId}/teams/{teamId}/members", h.ListMembers)
		r.Patch("/orgs/{orgId}/teams/{teamId}/members/{userId}", h.ChangeRole)
		r.Delete("/orgs/{orgId}/teams/{teamId}/members/{userId}", h.RemoveMember)
}

func (h *TeamHandler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	var input domain.CreateTeamInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	team, err := h.svc.CreateTeam(r.Context(), orgID, input, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecord(r, orgID, "team.created", "team", team.ID, nil)
	writeJSON(w, http.StatusCreated, team)
}

func (h *TeamHandler) ListTeams(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}
	page, perPage := parsePagination(r)
	teams, total, err := h.svc.ListByOrg(r.Context(), orgID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list teams")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(teams, total, page, perPage))
}

func (h *TeamHandler) GetTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, id, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	team, err := h.svc.GetTeam(r.Context(), orgID, id)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "team not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get team")
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamHandler) UpdateTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, id, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	var input domain.UpdateTeamInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	team, err := h.svc.UpdateTeam(r.Context(), orgID, id, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecord(r, orgID, "team.updated", "team", id, nil)
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamHandler) DeleteTeam(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	id, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	if err := h.svc.DeleteTeam(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete team")
		return
	}
	auditRecord(r, orgID, "team.deleted", "team", id, nil)
	writeJSON(w, http.StatusOK, map[string]string{"message": "team deleted"})
}

func (h *TeamHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
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
	writeJSON(w, http.StatusCreated, map[string]string{"message": "member added"})
}

func (h *TeamHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	page, perPage := parsePagination(r)
	members, total, err := h.svc.ListMembers(r.Context(), teamID, page, perPage)
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
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	var input domain.ChangeTeamRoleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.svc.ChangeRole(r.Context(), teamID, userID, input.Role); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "role updated"})
}

func (h *TeamHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	if err := h.svc.RemoveMember(r.Context(), teamID, userID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "member removed"})
}
