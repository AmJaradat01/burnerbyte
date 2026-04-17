package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type OrgHandler struct {
	svc *service.OrgService
}

func NewOrgHandler(svc *service.OrgService) *OrgHandler {
	return &OrgHandler{svc: svc}
}

func (h *OrgHandler) Routes(r chi.Router) {
	r.Post("/orgs", h.CreateOrg)
	r.Get("/orgs", h.ListOrgs)
	r.Get("/orgs/{orgId}", h.GetOrg)
	r.Patch("/orgs/{orgId}", h.UpdateOrg)
	r.Delete("/orgs/{orgId}", h.DeleteOrg)
	r.Get("/orgs/{orgId}/settings", h.GetSettings)
	r.Patch("/orgs/{orgId}/settings", h.UpdateSettings)
	r.Put("/orgs/{orgId}/settings", h.UpdateSettings)
	r.Post("/orgs/{orgId}/members", h.InviteMember)
	r.Get("/orgs/{orgId}/members", h.ListMembers)
	r.Patch("/orgs/{orgId}/members/{userId}", h.ChangeRole)
	r.Delete("/orgs/{orgId}/members/{userId}", h.RemoveMember)
	r.Post("/orgs/{orgId}/invites", h.InviteMember)
	r.Get("/orgs/{orgId}/invites", h.ListPendingInvites)
	r.Delete("/orgs/{orgId}/invites/{inviteId}", h.RevokeInvite)
	r.Post("/invites/{token}/accept", h.AcceptInvite)
}

func (h *OrgHandler) PreviewInvite(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	invite, err := h.svc.PreviewInvite(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusNotFound, "invite not found or expired")
		return
	}
	writeJSON(w, http.StatusOK, invite)
}

func (h *OrgHandler) CreateOrg(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.CreateOrgInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	org, err := h.svc.CreateOrg(r.Context(), input, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	auditRecordEnhanced(r, org.ID, "org.created", "org", org.ID, org.Name, map[string]any{"name": org.Name})
	writeJSON(w, http.StatusCreated, org)
}

func (h *OrgHandler) ListOrgs(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	page, perPage := parsePagination(r)

	orgs, total, err := h.svc.ListUserOrgs(r.Context(), uc.UserID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list orgs")
		return
	}

	writeJSON(w, http.StatusOK, paginatedResponse(orgs, total, page, perPage))
}

func (h *OrgHandler) GetOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}

	org, err := h.svc.GetOrg(r.Context(), orgID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			writeError(w, http.StatusNotFound, "org not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get org")
		return
	}

	writeJSON(w, http.StatusOK, org)
}

func (h *OrgHandler) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var input domain.UpdateOrgInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch before state for diff
	beforeOrg, _ := h.svc.GetOrg(r.Context(), orgID)

	org, err := h.svc.UpdateOrg(r.Context(), orgID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta := map[string]any{"name": input.Name, "logo_url": input.LogoURL}
	if beforeOrg != nil {
		meta["before"] = map[string]any{"name": beforeOrg.Name, "logo_url": beforeOrg.LogoURL}
		meta["after"] = map[string]any{"name": org.Name, "logo_url": org.LogoURL}
	}
	resourceName := org.Name
	auditRecordEnhanced(r, orgID, "org.updated", "org", orgID, resourceName, meta)
	writeJSON(w, http.StatusOK, org)
}

func (h *OrgHandler) DeleteOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgOwner) {
		return
	}

	// Fetch org before delete for audit
	beforeOrg, _ := h.svc.GetOrg(r.Context(), orgID)
	orgName := ""
	if beforeOrg != nil {
		orgName = beforeOrg.Name
	}

	if err := h.svc.DeleteOrg(r.Context(), orgID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete org")
		return
	}

	auditRecordEnhanced(r, orgID, "org.deleted", "org", orgID, orgName, map[string]any{"org_id": orgID.String(), "name": orgName})
	writeJSON(w, http.StatusOK, map[string]string{"message": "org deleted"})
}

func (h *OrgHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}

	settings, err := h.svc.GetSettings(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}

	writeJSON(w, http.StatusOK, settings)
}

func (h *OrgHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var settings domain.OrgSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch before state for diff
	beforeSettings, _ := h.svc.GetSettings(r.Context(), orgID)
	beforeOrg, _ := h.svc.GetOrg(r.Context(), orgID)

	org, err := h.svc.UpdateSettings(r.Context(), orgID, settings)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta := map[string]any{"enforce_sso": settings.EnforceSSO, "default_inbox_ttl": settings.DefaultInboxTTL, "max_inbox_ttl": settings.MaxInboxTTL, "attachments_enabled": settings.AttachmentsEnabled}
	if beforeSettings != nil {
		meta["before"] = map[string]any{"enforce_sso": beforeSettings.EnforceSSO, "default_inbox_ttl": beforeSettings.DefaultInboxTTL, "max_inbox_ttl": beforeSettings.MaxInboxTTL, "attachments_enabled": beforeSettings.AttachmentsEnabled}
		meta["after"] = map[string]any{"enforce_sso": org.Settings.EnforceSSO, "default_inbox_ttl": org.Settings.DefaultInboxTTL, "max_inbox_ttl": org.Settings.MaxInboxTTL, "attachments_enabled": org.Settings.AttachmentsEnabled}
	}
	resourceName := ""
	if beforeOrg != nil {
		resourceName = beforeOrg.Name
	}
	auditRecordEnhanced(r, orgID, "org.settings.updated", "org", orgID, resourceName, meta)
	writeJSON(w, http.StatusOK, org.Settings)
}

func (h *OrgHandler) InviteMember(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}

	var input domain.InviteMemberInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	invite, err := h.svc.InviteMember(r.Context(), orgID, input, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	orgName := ""
	if org, err := h.svc.GetOrg(r.Context(), orgID); err == nil && org != nil {
		orgName = org.Name
	}
	meta := map[string]any{"email": input.Email, "role": input.OrgRole, "org_name": orgName}
	if input.TeamID != nil {
		meta["team_id"] = *input.TeamID
		if invite.TeamRole != nil {
			meta["team_role"] = *invite.TeamRole
		}
	}
	auditRecordEnhanced(r, orgID, "member.invited", "org", orgID, input.Email, meta)
	writeJSON(w, http.StatusCreated, invite)
}

func (h *OrgHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}

	page, perPage := parsePagination(r)
	members, total, err := h.svc.ListMembers(r.Context(), orgID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}

	writeJSON(w, http.StatusOK, paginatedResponse(members, total, page, perPage))
}

func (h *OrgHandler) ChangeRole(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgOwner) {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}

	var input domain.ChangeRoleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch current membership to get old role before change
	oldRole := ""
	targetEmail := ""
	if membership, err := h.svc.GetMembership(r.Context(), userID, orgID); err == nil {
		oldRole = membership.Role
		targetEmail = membership.Email
	}

	if err := h.svc.ChangeRole(r.Context(), orgID, userID, input.Role); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta := map[string]any{"old_role": oldRole, "new_role": input.Role, "target_user_id": userID.String(), "target_user_email": targetEmail}
	auditRecordEnhanced(r, orgID, "member.role_changed", "org", userID, targetEmail, meta)
	writeJSON(w, http.StatusOK, map[string]string{"message": "role updated"})
}

func (h *OrgHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}

	// Fetch target user info before removal
	targetEmail := ""
	meta := map[string]any{"user_id": userID.String()}
	if membership, err := h.svc.GetMembership(r.Context(), userID, orgID); err == nil {
		targetEmail = membership.Email
		meta["target_user_email"] = membership.Email
		meta["target_user_display_name"] = membership.DisplayName
	}
	orgName := ""
	if org, err := h.svc.GetOrg(r.Context(), orgID); err == nil && org != nil {
		orgName = org.Name
	}
	meta["org_name"] = orgName

	if err := h.svc.RemoveMember(r.Context(), orgID, userID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	auditRecordEnhanced(r, orgID, "member.removed", "org", userID, targetEmail, meta)
	writeJSON(w, http.StatusOK, map[string]string{"message": "member removed"})
}

func (h *OrgHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	inviteID, err := uuid.Parse(chi.URLParam(r, "inviteId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invite ID")
		return
	}

	// Fetch invite details before revocation for audit
	inviteEmail := ""
	if invite, err := h.svc.GetInviteByID(r.Context(), inviteID); err == nil && invite != nil {
		inviteEmail = invite.Email
	}

	if err := h.svc.RevokeInvite(r.Context(), orgID, inviteID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	auditRecordEnhanced(r, orgID, "invite.revoked", "invite", inviteID, inviteEmail, map[string]any{"invite_id": inviteID.String(), "invite_email": inviteEmail})
	writeJSON(w, http.StatusOK, map[string]string{"message": "invite revoked"})
}

func (h *OrgHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	token := chi.URLParam(r, "token")

	result, err := h.svc.AcceptInvite(r.Context(), token, uc.UserID, uc.Email)
	if err != nil {
		if err.Error() == "invite not found" || err.Error() == "invite expired" {
			writeError(w, http.StatusNotFound, err.Error())
		} else if err.Error() == "email mismatch: this invite was sent to a different email address" {
			writeError(w, http.StatusForbidden, err.Error())
		} else {
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}

	meta := map[string]any{"email": uc.Email, "org_name": result.OrgName, "org_id": result.OrgID.String()}
	if result.TeamID != nil {
		meta["team_id"] = result.TeamID.String()
		meta["team_name"] = result.TeamName
		meta["team_role"] = result.TeamRole
	}
	auditRecordEnhanced(r, result.OrgID, "invite.accepted", "invite", uc.UserID, uc.Email, meta)
	writeJSON(w, http.StatusOK, map[string]string{"message": "invite accepted"})
}

func (h *OrgHandler) ListPendingInvites(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgAdmin) {
		return
	}
	invites, err := h.svc.ListPendingInvites(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list invites")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": invites})
}

func (h *OrgHandler) SearchMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	if checkOrgRole(w, r, orgID, rbac.OrgMember) {
		return
	}

	q := r.URL.Query().Get("q")
	var excludeTeamID *uuid.UUID
	if et := r.URL.Query().Get("exclude_team"); et != "" {
		id, err := uuid.Parse(et)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid exclude_team ID")
			return
		}
		excludeTeamID = &id
	}

	results, err := h.svc.SearchMembers(r.Context(), orgID, q, excludeTeamID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to search members")
		return
	}

	writeJSON(w, http.StatusOK, results)
}

// ── Pagination helpers ──

func parsePagination(r *http.Request) (page, perPage int) {
	page = 1
	perPage = 20
	if v := r.URL.Query().Get("page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	if v := r.URL.Query().Get("per_page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 100 {
			perPage = p
		}
	}
	return
}

func paginatedResponse(data any, total, page, perPage int) map[string]any {
	// Ensure nil slices serialize as [] not null
	if data == nil || reflect.ValueOf(data).IsNil() {
		data = []any{}
	}
	totalPages := total / perPage
	if total%perPage > 0 {
		totalPages++
	}
	return map[string]any{
		"data":        data,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	}
}
