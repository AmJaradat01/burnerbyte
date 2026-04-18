package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
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

	auditRecordEnhanced(r, orgID, "domain.created", "domain", d.ID, input.DomainName, map[string]any{"domain": input.DomainName, "description": input.Description})
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

	filter := domain.DomainListFilter{
		Search: r.URL.Query().Get("search"),
		Status: r.URL.Query().Get("status"),
	}

	// Validate status filter
	if filter.Status != "" && filter.Status != "verified" && filter.Status != "pending_verification" && filter.Status != "partially_verified" && filter.Status != "failed" {
		writeError(w, http.StatusBadRequest, "invalid status filter: must be verified, pending_verification, partially_verified, or failed")
		return
	}

	domains, total, err := h.svc.ListByOrg(r.Context(), orgID, filter, page, perPage)
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
		writeServiceError(w, err)
		return
	}

	meta := map[string]any{}
	domainName := d.DomainName
	if beforeDomain != nil {
		meta["before"] = map[string]any{"settings": beforeDomain.Settings, "description": beforeDomain.Description}
		meta["after"] = map[string]any{"settings": d.Settings, "description": d.Description}

		// Emit domain.settings_updated if settings changed
		if fmt.Sprintf("%v", beforeDomain.Settings) != fmt.Sprintf("%v", d.Settings) {
			auditRecordEnhanced(r, orgID, "domain.settings_updated", "domain", id, domainName, map[string]any{
				"domain_name": domainName,
				"before":      map[string]any{"settings": beforeDomain.Settings},
				"after":       map[string]any{"settings": d.Settings},
			})
		}
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

	auditRecordEnhanced(r, orgID, "domain.verified", "domain", id, d.DomainName, map[string]any{"domain": d.DomainName, "mx_verified": d.MXVerified, "txt_verified": d.TXTVerified, "spf_verified": d.SPFVerified})
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

	// Verify domain belongs to org (uses enriched get for full data)
	d, err := h.svc.GetDomain(r.Context(), orgID, domainID)
	if err != nil {
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
		"active_inbox_count": len(inboxes),
		"total_inbox_count":  d.TotalInboxes,
		"total_email_count":  d.TotalEmails,
		"assignment_count":   len(d.Assignments),
		"assignments":        d.Assignments,
		"active_inboxes":     len(inboxes),
		"total_emails":       totalEmails,
		"inboxes":            inboxes,
	})
}

func (h *DomainHandler) GetVerificationHistory(w http.ResponseWriter, r *http.Request) {
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

	page, perPage := parsePagination(r)
	history, total, err := h.svc.GetVerificationHistory(r.Context(), orgID, domainID, page, perPage)
	if err != nil {
		if err.Error() == "domain not found" {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get verification history")
		return
	}

	writeJSON(w, http.StatusOK, paginatedResponse(history, total, page, perPage))
}

func (h *DomainHandler) BulkVerify(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var input domain.BulkDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.DomainIDs) == 0 {
		writeError(w, http.StatusBadRequest, "domain_ids is required")
		return
	}
	if len(input.DomainIDs) > 50 {
		writeError(w, http.StatusBadRequest, "bulk operation limited to 50 domain IDs")
		return
	}

	result, err := h.svc.BulkVerify(r.Context(), orgID, input.DomainIDs)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, orgID, "domain.bulk_verified", "domain", uuid.Nil, "", map[string]any{
		"domain_ids":    input.DomainIDs,
		"verified_count": len(result.Results),
		"failed_count":  len(result.Failed),
	})
	writeJSON(w, http.StatusOK, result)
}

func (h *DomainHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var input domain.BulkDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.DomainIDs) == 0 {
		writeError(w, http.StatusBadRequest, "domain_ids is required")
		return
	}
	if len(input.DomainIDs) > 50 {
		writeError(w, http.StatusBadRequest, "bulk operation limited to 50 domain IDs")
		return
	}

	result, err := h.svc.BulkDelete(r.Context(), orgID, input.DomainIDs, input.Force)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, orgID, "domain.bulk_deleted", "domain", uuid.Nil, "", map[string]any{
		"domain_ids":    input.DomainIDs,
		"deleted_count": result.DeletedCount,
		"skipped_count": len(result.Skipped),
		"failed_count":  len(result.Failed),
		"force":         input.Force,
	})
	writeJSON(w, http.StatusOK, result)
}

func (h *DomainHandler) TransferDomain(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	// System admin check is done via middleware wrapping, but also verify org access
	uc := auth.GetUser(r.Context())
	if uc == nil || !uc.IsSystemAdmin {
		writeError(w, http.StatusForbidden, "system admin required")
		return
	}

	domainID, err := uuid.Parse(chi.URLParam(r, "domainId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid domain ID")
		return
	}

	var input domain.TransferDomainInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.TargetOrgID == uuid.Nil {
		writeError(w, http.StatusBadRequest, "invalid target_org_id")
		return
	}

	result, err := h.svc.TransferDomain(r.Context(), orgID, domainID, input.TargetOrgID)
	if err != nil {
		if err.Error() == "domain not found" || errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "domain not found")
			return
		}
		if err.Error() == "target organization not found" {
			writeError(w, http.StatusNotFound, "target organization not found")
			return
		}
		writeServiceError(w, err)
		return
	}

	// Audit in source org
	auditRecordEnhanced(r, orgID, "domain.transferred_out", "domain", domainID, result.Domain.DomainName, map[string]any{
		"domain_name":              result.Domain.DomainName,
		"target_org_id":            input.TargetOrgID.String(),
		"removed_assignments":      result.RemovedAssignmentsCount,
		"deactivated_inboxes":      result.DeactivatedInboxesCount,
	})
	// Audit in target org
	auditRecordEnhanced(r, input.TargetOrgID, "domain.transferred_in", "domain", domainID, result.Domain.DomainName, map[string]any{
		"domain_name":         result.Domain.DomainName,
		"source_org_id":       orgID.String(),
		"removed_assignments": result.RemovedAssignmentsCount,
		"deactivated_inboxes": result.DeactivatedInboxesCount,
	})

	writeJSON(w, http.StatusOK, result)
}
