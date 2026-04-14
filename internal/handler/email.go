package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type EmailHandler struct {
	svc           *service.EmailService
	attachmentSvc *service.AttachmentService
	inboxSvc      *service.InboxService
}

func NewEmailHandler(svc *service.EmailService, attachmentSvc *service.AttachmentService, inboxSvc *service.InboxService) *EmailHandler {
	return &EmailHandler{svc: svc, attachmentSvc: attachmentSvc, inboxSvc: inboxSvc}
}

func (h *EmailHandler) Routes(r chi.Router) {
		r.Get("/inboxes/{inboxId}/emails", h.ListEmails)
		r.Post("/inboxes/{inboxId}/emails/mark-all-read", h.MarkAllRead)
		r.Get("/emails/{emailId}", h.GetEmail)
		r.Patch("/emails/{emailId}", h.MarkReadUnread)
		r.Delete("/emails/{emailId}", h.DeleteEmail)
}

func (h *EmailHandler) ListEmails(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "email:read") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
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
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "email:read") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
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

func (h *EmailHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "email:write") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	inboxID, err := uuid.Parse(chi.URLParam(r, "inboxId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid inbox ID")
		return
	}
	count, err := h.svc.MarkAllRead(r.Context(), inboxID, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	inboxAddress := ""
	if h.inboxSvc != nil {
		if inbox, err := h.inboxSvc.GetInbox(r.Context(), inboxID, uc.UserID); err == nil && inbox != nil {
			inboxAddress = inbox.FullAddress
		}
	}

	auditRecordEnhanced(r, uuid.Nil, "email.all_read", "inbox", inboxID, "", map[string]any{
		"inbox_id":      inboxID.String(),
		"count":         count,
		"inbox_address": inboxAddress,
	})
	writeJSON(w, http.StatusOK, map[string]int64{"marked": count})
}

func (h *EmailHandler) MarkReadUnread(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "email:write") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
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
	if uc != nil && len(uc.APIKeyScopes) > 0 && !auth.HasScope(r.Context(), "email:delete") {
		writeError(w, http.StatusForbidden, "insufficient scope")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "emailId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid email ID")
		return
	}

	// Fetch email before delete for audit
	email, err := h.svc.GetEmail(r.Context(), id, uc.UserID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.svc.DeleteEmail(r.Context(), id, uc.UserID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	subject := ""
	if email.Subject != nil {
		subject = *email.Subject
	}
	auditRecordEnhanced(r, uuid.Nil, "email.deleted", "email", id, subject, map[string]any{
		"subject":       subject,
		"inbox_address": email.ToAddress,
		"from_address":  email.FromAddress,
	})
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
