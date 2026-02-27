package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type DomainAssignmentHandler struct {
	svc *service.DomainAssignmentService
}

func NewDomainAssignmentHandler(svc *service.DomainAssignmentService) *DomainAssignmentHandler {
	return &DomainAssignmentHandler{svc: svc}
}

func (h *DomainAssignmentHandler) Routes(r chi.Router) {
		r.Post("/orgs/{orgId}/teams/{teamId}/domains", h.AssignDomain)
		r.Get("/orgs/{orgId}/teams/{teamId}/domains", h.ListAssignments)
		r.Patch("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", h.UpdateAssignment)
		r.Delete("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", h.Unassign)
}

func (h *DomainAssignmentHandler) AssignDomain(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
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
	writeJSON(w, http.StatusCreated, a)
}

func (h *DomainAssignmentHandler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
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
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
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
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
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
	writeJSON(w, http.StatusOK, map[string]string{"message": "domain unassigned"})
}
