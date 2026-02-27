package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type DomainHandler struct {
	svc *service.DomainService
}

func NewDomainHandler(svc *service.DomainService) *DomainHandler {
	return &DomainHandler{svc: svc}
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

	writeJSON(w, http.StatusCreated, d)
}

func (h *DomainHandler) ListDomains(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
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
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	d, err := h.svc.GetDomain(r.Context(), id)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get domain")
		return
	}

	writeJSON(w, http.StatusOK, d)
}

func (h *DomainHandler) UpdateDomain(w http.ResponseWriter, r *http.Request) {
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

	d, err := h.svc.UpdateDomain(r.Context(), id, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, d)
}

func (h *DomainHandler) DeleteDomain(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	if err := h.svc.DeleteDomain(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete domain")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "domain deleted"})
}

func (h *DomainHandler) VerifyDomain(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	d, err := h.svc.TriggerVerify(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "verification failed")
		return
	}

	writeJSON(w, http.StatusOK, d)
}
