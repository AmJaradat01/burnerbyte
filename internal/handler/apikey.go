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

type APIKeyHandler struct{ svc *service.APIKeyService }

func NewAPIKeyHandler(svc *service.APIKeyService) *APIKeyHandler { return &APIKeyHandler{svc: svc} }

func (h *APIKeyHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)
		r.Post("/orgs/{orgId}/teams/{teamId}/api-keys", h.Create)
		r.Get("/orgs/{orgId}/teams/{teamId}/api-keys", h.List)
		r.Delete("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", h.Revoke)
	})
}

func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	var input domain.CreateAPIKeyInput
	json.NewDecoder(r.Body).Decode(&input)
	key, err := h.svc.Generate(r.Context(), teamID, uc.UserID, input)
	if err != nil { writeError(w, http.StatusBadRequest, err.Error()); return }
	writeJSON(w, http.StatusCreated, key)
}

func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	teamID, _ := uuid.Parse(chi.URLParam(r, "teamId"))
	page, perPage := parsePagination(r)
	keys, total, err := h.svc.List(r.Context(), teamID, page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(keys, total, page, perPage))
}

func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(chi.URLParam(r, "keyId"))
	if err := h.svc.Revoke(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed"); return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "key revoked"})
}
