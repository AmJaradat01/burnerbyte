package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type DomainAssignmentHandler struct {
	svc *service.DomainAssignmentService
}

func NewDomainAssignmentHandler(svc *service.DomainAssignmentService) *DomainAssignmentHandler {
	return &DomainAssignmentHandler{svc: svc}
}

func (h *DomainAssignmentHandler) Routes(r chi.Router) {
		r.Get("/my/domains", h.ListMyDomains)
		r.Post("/orgs/{orgId}/teams/{teamId}/domains", h.AssignDomain)
		r.Get("/orgs/{orgId}/teams/{teamId}/domains", h.ListAssignments)
		r.Patch("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", h.UpdateAssignment)
		r.Delete("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", h.Unassign)
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
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	var input domain.CreateAssignmentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	a, err := h.svc.AssignDomain(r.Context(), teamID, input, uc.UserID)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "domain already assigned to this team" {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	auditRecord(r, orgID, "domain.assigned", "domain_assignment", a.ID)
	writeJSON(w, http.StatusCreated, a)
}

func (h *DomainAssignmentHandler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamViewer) {
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
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
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
	a, err := h.svc.UpdateAssignment(r.Context(), teamID, domainID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *DomainAssignmentHandler) Unassign(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	domainID, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}
	if err := h.svc.Unassign(r.Context(), teamID, domainID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecord(r, orgID, "domain.unassigned", "domain_assignment", domainID)
	writeJSON(w, http.StatusOK, map[string]string{"message": "domain unassigned"})
}
