package domain

import (
	"time"

	"github.com/google/uuid"
)

type Email struct {
	ID             uuid.UUID    `json:"id"`
	InboxID        uuid.UUID    `json:"inbox_id"`
	MessageID      *string      `json:"message_id,omitempty"`
	FromAddress    string       `json:"from_address"`
	ToAddress      string       `json:"to_address"`
	Subject        *string      `json:"subject,omitempty"`
	BodyText       *string      `json:"body_text,omitempty"`
	BodyHTML       *string      `json:"body_html,omitempty"`
	HasAttachments bool         `json:"has_attachments"`
	RawHeaders     any          `json:"raw_headers,omitempty"`
	SizeBytes      int64        `json:"size_bytes"`
	SpamScore      float32      `json:"spam_score"`
	IsRead         bool         `json:"is_read"`
	ReceivedAt     time.Time    `json:"received_at"`
	ExpiresAt      time.Time    `json:"expires_at"`
	Attachments    []Attachment `json:"attachments,omitempty"`
}

type EmailSummary struct {
	ID             uuid.UUID `json:"id"`
	FromAddress    string    `json:"from_address"`
	Subject        *string   `json:"subject,omitempty"`
	Snippet        string    `json:"snippet"`
	HasAttachments bool      `json:"has_attachments"`
	IsRead         bool      `json:"is_read"`
	SizeBytes      int64     `json:"size_bytes"`
	ReceivedAt     time.Time `json:"received_at"`
}

type SearchInput struct {
	Query string `json:"query"`
}
