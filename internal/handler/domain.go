package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type DomainHandler struct {
	svc      *service.DomainService
	mxTarget string
}

func NewDomainHandler(svc *service.DomainService, smtpHostname string) *DomainHandler {
	return &DomainHandler{svc: svc, mxTarget: smtpHostname}
}

func (h *DomainHandler) Routes(r chi.Router) {

		r.Post("/orgs/{orgId}/domains", h.CreateDomain)
		r.Get("/orgs/{orgId}/domains", h.ListDomains)
		r.Get("/orgs/{orgId}/domains/{domainId}", h.GetDomain)
		r.Patch("/orgs/{orgId}/domains/{domainId}", h.UpdateDomain)
		r.Delete("/orgs/{orgId}/domains/{domainId}", h.DeleteDomain)
		r.Post("/orgs/{orgId}/domains/{domainId}/verify", h.VerifyDomain)
}

func (h *DomainHandler) CreateDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var input domain.CreateDomainInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	d, err := h.svc.AddDomain(r.Context(), orgID, input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "domain already registered" {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}

	auditRecord(r, orgID, "domain.created", "domain", d.ID, map[string]any{"domain": input.DomainName})
	writeJSON(w, http.StatusCreated, d)
}

func (h *DomainHandler) ListDomains(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}

	page, perPage := parsePagination(r)
	domains, total, err := h.svc.ListByOrg(r.Context(), orgID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list domains")
		return
	}

	writeJSON(w, http.StatusOK, paginatedResponse(domains, total, page, perPage))
}

func (h *DomainHandler) GetDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	d, err := h.svc.GetDomain(r.Context(), orgID, id)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get domain")
		return
	}

	writeJSON(w, http.StatusOK, struct {
		domain.Domain
		MXTarget string `json:"mx_target"`
	}{*d, h.mxTarget})
}

func (h *DomainHandler) UpdateDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	var input domain.UpdateDomainInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	d, err := h.svc.UpdateDomain(r.Context(), orgID, id, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, d)
}

func (h *DomainHandler) DeleteDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	if err := h.svc.DeleteDomain(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete domain")
		return
	}

	auditRecord(r, orgID, "domain.deleted", "domain", id, nil)
	writeJSON(w, http.StatusOK, map[string]string{"message": "domain deleted"})
}

func (h *DomainHandler) VerifyDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	d, err := h.svc.TriggerVerify(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "verification failed")
		return
	}

	auditRecord(r, orgID, "domain.verified", "domain", id, nil)
	writeJSON(w, http.StatusOK, d)
}
