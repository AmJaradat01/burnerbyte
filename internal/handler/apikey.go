package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/auth/rbac"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type APIKeyHandler struct{ svc *service.APIKeyService }

func NewAPIKeyHandler(svc *service.APIKeyService) *APIKeyHandler { return &APIKeyHandler{svc: svc} }

func (h *APIKeyHandler) Routes(r chi.Router) {
		r.Post("/orgs/{orgId}/teams/{teamId}/api-keys", h.Create)
		r.Get("/orgs/{orgId}/teams/{teamId}/api-keys", h.List)
		r.Delete("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", h.Revoke)
}

func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	var input domain.CreateAPIKeyInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body"); return
	}
	key, err := h.svc.Generate(r.Context(), teamID, uc.UserID, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	auditRecord(r, orgID, "apikey.created", "api_key", key.ID)
	writeJSON(w, http.StatusCreated, key)
}

func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgMember, rbac.TeamMember) {
		return
	}
	page, perPage := parsePagination(r)
	keys, total, err := h.svc.List(r.Context(), teamID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(keys, total, page, perPage))
}

func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead) {
		return
	}
	id, _ := uuid.Parse(chi.URLParam(r, "keyId"))
	if err := h.svc.Revoke(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed"); return
	}
	auditRecord(r, orgID, "apikey.revoked", "api_key", id)
	writeJSON(w, http.StatusOK, map[string]string{"message": "key revoked"})
}
