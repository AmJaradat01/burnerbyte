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
	svc       *service.DomainService
	inboxRepo *postgres.InboxRepo
	mxTarget  string
}

func NewDomainHandler(svc *service.DomainService, inboxRepo *postgres.InboxRepo, smtpHostname string) *DomainHandler {
	return &DomainHandler{svc: svc, inboxRepo: inboxRepo, mxTarget: smtpHostname}
}

func (h *DomainHandler) Routes(r chi.Router) {

		r.Post("/orgs/{orgId}/domains", h.CreateDomain)
		r.Get("/orgs/{orgId}/domains", h.ListDomains)
		r.Get("/orgs/{orgId}/domains/{domainId}", h.GetDomain)
		r.Patch("/orgs/{orgId}/domains/{domainId}", h.UpdateDomain)
		r.Delete("/orgs/{orgId}/domains/{domainId}", h.DeleteDomain)
		r.Post("/orgs/{orgId}/domains/{domainId}/verify", h.VerifyDomain)
		r.Get("/orgs/{orgId}/domains/{domainId}/impact", h.GetDomainImpact)
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

	auditRecordEnhanced(r, orgID, "domain.created", "domain", d.ID, input.DomainName, map[string]any{"domain": input.DomainName})
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

	// Fetch before state for diff
	beforeDomain, _ := h.svc.GetDomain(r.Context(), orgID, id)

	d, err := h.svc.UpdateDomain(r.Context(), orgID, id, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta := map[string]any{}
	domainName := d.DomainName
	if beforeDomain != nil {
		meta["before"] = map[string]any{"settings": beforeDomain.Settings}
		meta["after"] = map[string]any{"settings": d.Settings}
	}
	auditRecordEnhanced(r, orgID, "domain.updated", "domain", id, domainName, meta)
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

	// Fetch domain before delete for audit
	beforeDomain, _ := h.svc.GetDomain(r.Context(), orgID, id)
	domainName := ""
	if beforeDomain != nil {
		domainName = beforeDomain.DomainName
	}

	// Check for active inboxes — require force=true to delete with active inboxes
	activeInboxes, _ := h.inboxRepo.ListActiveByDomain(r.Context(), id)
	if len(activeInboxes) > 0 && r.URL.Query().Get("force") != "true" {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":          "domain has active inboxes",
			"active_inboxes": len(activeInboxes),
			"message":        "Add ?force=true to delete this domain and all its active inboxes",
		})
		return
	}

	if err := h.svc.DeleteDomain(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete domain")
		return
	}

	auditRecordEnhanced(r, orgID, "domain.deleted", "domain", id, domainName, map[string]any{"domain_id": id.String(), "domain_name": domainName, "force": len(activeInboxes) > 0, "active_inboxes_deleted": len(activeInboxes)})
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

	auditRecordEnhanced(r, orgID, "domain.verified", "domain", id, d.DomainName, map[string]any{"domain": d.DomainName, "mx_verified": d.MXVerified, "txt_verified": d.TXTVerified})
	writeJSON(w, http.StatusOK, d)
}

func (h *DomainHandler) GetDomainImpact(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
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

	// Verify domain belongs to org
	if _, err := h.svc.GetDomain(r.Context(), orgID, domainID); err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get domain")
		return
	}

	inboxes, err := h.inboxRepo.ListActiveByDomain(r.Context(), domainID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get impact data")
		return
	}
	if inboxes == nil {
		inboxes = []postgres.DomainInboxImpact{}
	}

	totalEmails := 0
	for _, inbox := range inboxes {
		totalEmails += inbox.EmailCount
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"active_inboxes": len(inboxes),
		"total_emails":   totalEmails,
		"inboxes":        inboxes,
	})
}
