package domain

import (
	"time"

	"github.com/google/uuid"
)

type Domain struct {
	ID                 uuid.UUID      `json:"id"`
	OrgID              uuid.UUID      `json:"org_id"`
	DomainName         string         `json:"domain_name"`
	MXVerified         bool           `json:"mx_verified"`
	TXTVerified        bool           `json:"txt_verified"`
	VerificationRecord string         `json:"verification_record"`
	DNSLastCheckedAt   *time.Time     `json:"dns_last_checked_at,omitempty"`
	Settings           DomainSettings `json:"settings"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	// Joined counts
	ActiveInboxes       int `json:"active_inboxes"`
	InboxesCreatedCount int `json:"inboxes_created_count"`
	TeamCount           int `json:"team_count"`
}

type DomainSettings struct {
	AttachmentsEnabled *string `json:"attachments_enabled,omitempty"` // "inherit" | "enabled" | "disabled"
}

type CreateDomainInput struct {
	DomainName string `json:"domain_name"`
}

type UpdateDomainInput struct {
	Settings *DomainSettings `json:"settings,omitempty"`
}
