package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type OrgHandler struct {
	svc *service.OrgService
}

func NewOrgHandler(svc *service.OrgService) *OrgHandler {
	return &OrgHandler{svc: svc}
}

func (h *OrgHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)

		r.Post("/orgs", h.CreateOrg)
		r.Get("/orgs", h.ListOrgs)

		r.Route("/orgs/{orgId}", func(r chi.Router) {
			r.Get("/", h.GetOrg)
			r.Patch("/", h.UpdateOrg)
			r.Delete("/", h.DeleteOrg)

			r.Get("/settings", h.GetSettings)
			r.Patch("/settings", h.UpdateSettings)

			r.Post("/members", h.InviteMember)
			r.Get("/members", h.ListMembers)
			r.Patch("/members/{userId}", h.ChangeRole)
			r.Delete("/members/{userId}", h.RemoveMember)

			r.Post("/invites", h.InviteMember)
		})

		r.Post("/invites/{token}/accept", h.AcceptInvite)
	})
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

	var input domain.UpdateOrgInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	org, err := h.svc.UpdateOrg(r.Context(), orgID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, org)
}

func (h *OrgHandler) DeleteOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}

	if err := h.svc.DeleteOrg(r.Context(), orgID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete org")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "org deleted"})
}

func (h *OrgHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
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

	var settings domain.OrgSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	org, err := h.svc.UpdateSettings(r.Context(), orgID, settings)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, org.Settings)
}

func (h *OrgHandler) InviteMember(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
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

	writeJSON(w, http.StatusCreated, invite)
}

func (h *OrgHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
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

	if err := h.svc.ChangeRole(r.Context(), orgID, userID, input.Role); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "role updated"})
}

func (h *OrgHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(chi.URLParam(r, "orgId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid org ID")
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}

	if err := h.svc.RemoveMember(r.Context(), orgID, userID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "member removed"})
}

func (h *OrgHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	token := chi.URLParam(r, "token")

	if err := h.svc.AcceptInvite(r.Context(), token, uc.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "invite accepted"})
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
