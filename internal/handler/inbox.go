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

type InboxHandler struct {
	svc *service.InboxService
}

func NewInboxHandler(svc *service.InboxService) *InboxHandler {
	return &InboxHandler{svc: svc}
}

func (h *InboxHandler) Routes(r chi.Router, authMw func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(authMw)
		r.Post("/teams/{teamId}/domains/{domainId}/inboxes", h.CreateInbox)
		r.Get("/teams/{teamId}/inboxes", h.ListInboxes)
		r.Get("/inboxes/{inboxId}", h.GetInbox)
		r.Patch("/inboxes/{inboxId}", h.ExtendTTL)
		r.Delete("/inboxes/{inboxId}", h.DeleteInbox)
	})
}

func (h *InboxHandler) CreateInbox(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
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
	var input domain.CreateInboxInput
	json.NewDecoder(r.Body).Decode(&input)

	inbox, err := h.svc.CreateInbox(r.Context(), teamID, domainID, uc.UserID, input)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "address already taken" {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inbox)
}

func (h *InboxHandler) ListInboxes(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	teamID, err := uuid.Parse(chi.URLParam(r, "teamId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid team ID")
		return
	}
	page, perPage := parsePagination(r)
	inboxes, total, err := h.svc.ListByTeam(r.Context(), teamID, uc.UserID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list inboxes")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(inboxes, total, page, perPage))
}

func (h *InboxHandler) GetInbox(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	inbox, err := h.svc.GetInbox(r.Context(), id, uc.UserID)
	if err != nil {
		if err.Error() == "forbidden: not your inbox" {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		writeError(w, http.StatusNotFound, "inbox not found")
		return
	}
	writeJSON(w, http.StatusOK, inbox)
}

func (h *InboxHandler) ExtendTTL(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	var body struct {
		Extension string `json:"extension"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Extension == "" {
		writeError(w, http.StatusBadRequest, "extension is required (e.g. \"30m\")")
		return
	}
	inbox, err := h.svc.ExtendTTL(r.Context(), id, uc.UserID, body.Extension)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inbox)
}

func (h *InboxHandler) DeleteInbox(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	if err := h.svc.DeleteInbox(r.Context(), id, uc.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "inbox deleted"})
}
