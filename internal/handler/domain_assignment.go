package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
	"github.com/amjaradat01/burnerbyte/internal/service"
)

type DomainAssignmentHandler struct {
	svc       *service.DomainAssignmentService
	inboxRepo *postgres.InboxRepo
	teamSvc   *service.TeamService
}

func NewDomainAssignmentHandler(svc *service.DomainAssignmentService, inboxRepo *postgres.InboxRepo, teamSvc *service.TeamService) *DomainAssignmentHandler {
	return &DomainAssignmentHandler{svc: svc, inboxRepo: inboxRepo, teamSvc: teamSvc}
}

func (h *DomainAssignmentHandler) ListMyDomains(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	assignments, err := h.svc.ListByUser(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list domains")
		return
	}
	if assignments == nil {
		assignments = []domain.DomainAssignment{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": assignments})
}

func (h *DomainAssignmentHandler) AssignDomain(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.domains.manage") {
		return
	}
	var input domain.CreateAssignmentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	a, err := h.svc.AssignDomain(r.Context(), teamID, input, uc.UserID, orgID)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "domain already assigned to this team" {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	domainName := a.DomainName
	teamName := ""
	if h.teamSvc != nil {
		if team, err := h.teamSvc.GetTeam(r.Context(), orgID, teamID); err == nil && team != nil {
			teamName = team.Name
		}
	}
	auditRecordEnhanced(r, orgID, "domain.assigned", "domain_assignment", a.ID, domainName, map[string]any{"domain_id": a.DomainID.String(), "team_id": teamID.String(), "domain_name": domainName, "team_name": teamName})
	writeJSON(w, http.StatusCreated, a)
}

func (h *DomainAssignmentHandler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.domains.view") {
		return
	}
	page, perPage := parsePagination(r)
	assignments, total, err := h.svc.ListByTeam(r.Context(), teamID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list assignments")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(assignments, total, page, perPage))
}

func (h *DomainAssignmentHandler) UpdateAssignment(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamPermission(w, r, orgID, teamID, "team.domains.manage") {
		return
	}
	domainID, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}
	var input domain.UpdateAssignmentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch before state for diff
	beforeAssignment, _ := h.svc.GetByTeamAndDomain(r.Context(), teamID, domainID)

	a, err := h.svc.UpdateAssignment(r.Context(), teamID, domainID, input)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	meta := map[string]any{}
	domainName := a.DomainName
	if beforeAssignment != nil {
		meta["before"] = map[string]any{"access_level": beforeAssignment.AccessLevel, "settings": beforeAssignment.Settings}
		meta["after"] = map[string]any{"access_level": a.AccessLevel, "settings": a.Settings}
	}
	auditRecordEnhanced(r, orgID, "domain_assignment.updated", "domain_assignment", a.ID, domainName, meta)
	writeJSON(w, http.StatusOK, a)
}

func (h *DomainAssignmentHandler) Unassign(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgPermission(w, r, orgID, "org.domains.manage") {
		return
	}
	domainID, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	// Look up assignment to get its ID for inbox count check
	assignment, err := h.svc.GetByTeamAndDomain(r.Context(), teamID, domainID)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	// Check for active inboxes — require force=true to unassign with active inboxes
	activeCount, _ := h.inboxRepo.CountActiveByAssignment(r.Context(), assignment.ID)
	if activeCount > 0 && r.URL.Query().Get("force") != "true" {
		inboxes, _ := h.inboxRepo.ListActiveByDomain(r.Context(), domainID)
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":          "domain assignment has active inboxes",
			"active_inboxes": activeCount,
			"inboxes":        inboxes,
			"message":        "Add ?force=true to unassign this domain and delete all its active inboxes",
		})
		return
	}

	if err := h.svc.Unassign(r.Context(), teamID, domainID); err != nil {
		writeServiceError(w, err)
		return
	}
	domainName := assignment.DomainName
	auditRecordEnhanced(r, orgID, "domain.unassigned", "domain_assignment", domainID, domainName, map[string]any{"domain_id": domainID.String(), "team_id": teamID.String(), "domain_name": domainName, "force": activeCount > 0, "active_inboxes_deleted": activeCount})
	w.WriteHeader(http.StatusNoContent)
}
