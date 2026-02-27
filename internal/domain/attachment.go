package domain

import (
	"time"

	"github.com/google/uuid"
)

type Attachment struct {
	ID          uuid.UUID `json:"id"`
	EmailID     uuid.UUID `json:"email_id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	StorageKey  string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
	DownloadURL string    `json:"download_url,omitempty"`
}
