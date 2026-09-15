package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/service"
)

type APIKeyHandler struct{ svc *service.APIKeyService }

func NewAPIKeyHandler(svc *service.APIKeyService) *APIKeyHandler { return &APIKeyHandler{svc: svc} }

func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.manage") {
		return
	}
	var input domain.CreateAPIKeyInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	key, err := h.svc.Generate(r.Context(), teamID, uc.UserID, input)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "apikey.created", "api_key", key.ID, input.Name, map[string]any{"name": input.Name})
	writeJSON(w, http.StatusCreated, key)
}

func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.view") {
		return
	}
	page, perPage := parsePagination(r)
	includeRevoked := r.URL.Query().Get("include_revoked") == "true"
	keys, total, err := h.svc.List(r.Context(), teamID, includeRevoked, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(keys, total, page, perPage))
}

func (h *APIKeyHandler) Get(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.view") {
		return
	}
	keyID, err := uuid.Parse(chi.URLParam(r, "keyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	key, err := h.svc.Get(r.Context(), teamID, keyID)
	if err != nil {
		writeError(w, http.StatusNotFound, "API key not found")
		return
	}
	writeJSON(w, http.StatusOK, key)
}

func (h *APIKeyHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.manage") {
		return
	}
	keyID, err := uuid.Parse(chi.URLParam(r, "keyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}

	// Fetch key before update for diffs
	beforeKey, _ := h.svc.Get(r.Context(), teamID, keyID)

	var input domain.UpdateAPIKeyInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	key, err := h.svc.Update(r.Context(), teamID, keyID, input)
	if err != nil {
		if err.Error() == "API key not found" {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeServiceError(w, err)
		return
	}

	meta := map[string]any{"key_id": keyID.String(), "key_name": key.Name}
	if beforeKey != nil {
		meta["before"] = map[string]any{"name": beforeKey.Name, "scopes": beforeKey.Scopes, "is_active": beforeKey.IsActive}
		meta["after"] = map[string]any{"name": key.Name, "scopes": key.Scopes, "is_active": key.IsActive}

		// Emit apikey.disabled / apikey.enabled events on is_active toggle
		if beforeKey.IsActive && !key.IsActive {
			auditRecordEnhanced(r, orgID, "apikey.disabled", "api_key", keyID, key.Name, map[string]any{"key_id": keyID.String(), "key_name": key.Name})
		} else if !beforeKey.IsActive && key.IsActive {
			auditRecordEnhanced(r, orgID, "apikey.enabled", "api_key", keyID, key.Name, map[string]any{"key_id": keyID.String(), "key_name": key.Name})
		}
	}
	auditRecordEnhanced(r, orgID, "apikey.updated", "api_key", keyID, key.Name, meta)
	writeJSON(w, http.StatusOK, key)
}

func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.manage") {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "keyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}

	// Fetch key before revocation for audit
	keyName := ""
	if key, err := h.svc.Get(r.Context(), teamID, id); err == nil && key != nil {
		keyName = key.Name
	}

	if err := h.svc.Revoke(r.Context(), teamID, id, uc.UserID); err != nil {
		if err.Error() == "API key not found" {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	resourceName := keyName
	if resourceName == "" {
		resourceName = id.String()
	}
	auditRecordEnhanced(r, orgID, "apikey.revoked", "api_key", id, resourceName, map[string]any{"key_id": id.String(), "key_name": keyName})
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIKeyHandler) Rotate(w http.ResponseWriter, r *http.Request) {
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.manage") {
		return
	}
	keyID, err := uuid.Parse(chi.URLParam(r, "keyId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	key, err := h.svc.Rotate(r.Context(), teamID, keyID)
	if err != nil {
		if err.Error() == "API key not found" {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "apikey.rotated", "api_key", keyID, key.Name, map[string]any{"key_id": keyID.String(), "key_name": key.Name})
	writeJSON(w, http.StatusOK, key)
}

func (h *APIKeyHandler) BulkRevoke(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	orgID, _ := uuid.Parse(chi.URLParam(r, "orgId"))
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	if checkTeamPermission(w, r, orgID, teamID, "team.apikeys.manage") {
		return
	}
	var input domain.BulkRevokeInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.KeyIDs) == 0 {
		writeError(w, http.StatusBadRequest, "key_ids is required")
		return
	}

	// Fetch key names before revocation for audit
	var keyNames []string
	for _, kid := range input.KeyIDs {
		if key, err := h.svc.Get(r.Context(), teamID, kid); err == nil && key != nil {
			keyNames = append(keyNames, key.Name)
		}
	}

	result, err := h.svc.BulkRevoke(r.Context(), teamID, uc.UserID, input)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	auditRecordEnhanced(r, orgID, "apikey.bulk_revoked", "api_key", uuid.Nil, "", map[string]any{
		"revoked":   result.Revoked,
		"skipped":   result.Skipped,
		"key_names": keyNames,
	})
	writeJSON(w, http.StatusOK, result)
}
