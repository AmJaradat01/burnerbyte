package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

type EmailHandler struct {
	svc           *service.EmailService
	attachmentSvc *service.AttachmentService
}

func NewEmailHandler(svc *service.EmailService, attachmentSvc *service.AttachmentService) *EmailHandler {
	return &EmailHandler{svc: svc, attachmentSvc: attachmentSvc}
}

func (h *EmailHandler) Routes(r chi.Router) {
		r.Get("/inboxes/{inboxId}/emails", h.ListEmails)
		r.Get("/emails/{emailId}", h.GetEmail)
		r.Patch("/emails/{emailId}", h.MarkReadUnread)
		r.Delete("/emails/{emailId}", h.DeleteEmail)
}

func (h *EmailHandler) ListEmails(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	inboxID, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	page, perPage := parsePagination(r)

	q := r.URL.Query().Get("q")
	if q != "" {
		emails, total, err := h.svc.Search(r.Context(), inboxID, uc.UserID, q, page, perPage)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, paginatedResponse(emails, total, page, perPage))
		return
	}

	emails, total, err := h.svc.ListByInbox(r.Context(), inboxID, uc.UserID, page, perPage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(emails, total, page, perPage))
}

func (h *EmailHandler) GetEmail(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "emailId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid email ID")
		return
	}
	email, err := h.svc.GetEmail(r.Context(), id, uc.UserID)
	if err != nil {
		if err.Error() == "forbidden: not your email" {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		writeError(w, http.StatusNotFound, "email not found")
		return
	}
	writeJSON(w, http.StatusOK, email)
}

func (h *EmailHandler) MarkReadUnread(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "emailId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid email ID")
		return
	}
	var body struct {
		IsRead bool `json:"is_read"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.svc.MarkReadUnread(r.Context(), id, uc.UserID, body.IsRead); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "updated"})
}

func (h *EmailHandler) DeleteEmail(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "emailId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid email ID")
		return
	}
	if err := h.svc.DeleteEmail(r.Context(), id, uc.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "email deleted"})
}

func (h *EmailHandler) DownloadAttachment(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if h.attachmentSvc == nil {
		writeError(w, http.StatusNotImplemented, "attachments not configured")
		return
	}
	attachmentID, err := uuid.Parse(chi.URLParam(r, "attachmentId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid attachment ID")
		return
	}
	url, err := h.attachmentSvc.GetDownloadURL(r.Context(), attachmentID, uc.UserID)
	if err != nil {
		if err.Error() == "forbidden: not your attachment" {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}
