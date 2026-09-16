package domain

import (
	"time"

	"github.com/google/uuid"
)

type Domain struct {
	ID                 uuid.UUID      `json:"id"`
	OrgID              uuid.UUID      `json:"org_id"`
	DomainName         string         `json:"domain_name"`
	Description        string         `json:"description,omitempty"`
	MXVerified         bool           `json:"mx_verified"`
	TXTVerified        bool           `json:"txt_verified"`
	SPFVerified        bool           `json:"spf_verified"`
	Status             string         `json:"status"`
	VerificationRecord string         `json:"verification_record"`
	DNSLastCheckedAt   *time.Time     `json:"dns_last_checked_at,omitempty"`
	Settings           DomainSettings `json:"settings"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	// Joined counts
	ActiveInboxes       int `json:"active_inboxes"`
	TotalInboxes        int `json:"total_inboxes"`
	InboxesCreatedCount int `json:"inboxes_created_count"`
	TotalEmails         int `json:"total_emails"`
	TeamCount           int `json:"team_count"`
	EmailsReceivedCount int `json:"emails_received_count"`
	// Enriched detail (populated on GetDomain only)
	Assignments []DomainAssignmentSummary `json:"assignments,omitempty"`
}

type DomainSettings struct {
	AttachmentsEnabled  *string `json:"attachments_enabled,omitempty"` // "inherit" | "enabled" | "disabled"
	DefaultInboxTTL     *string `json:"default_inbox_ttl,omitempty"`
	MaxInboxTTL         *string `json:"max_inbox_ttl,omitempty"`
	MaxInboxesPerDomain *int    `json:"max_inboxes_per_domain,omitempty"`
}

type DomainAssignmentSummary struct {
	TeamID      uuid.UUID `json:"team_id"`
	TeamName    string    `json:"team_name"`
	AccessLevel string    `json:"access_level"`
}

type CreateDomainInput struct {
	DomainName  string `json:"domain_name"`
	Description string `json:"description,omitempty"`
}

type UpdateDomainInput struct {
	Description *string         `json:"description,omitempty"`
	Settings    *DomainSettings `json:"settings,omitempty"`
}

type DomainListFilter struct {
	Search string
	Status string
}

type VerificationHistory struct {
	ID            uuid.UUID `json:"id"`
	DomainID      uuid.UUID `json:"domain_id"`
	CheckedAt     time.Time `json:"checked_at"`
	MXResult      bool      `json:"mx_result"`
	TXTResult     bool      `json:"txt_result"`
	SPFResult     bool      `json:"spf_result"`
	TriggerSource string    `json:"trigger_source"`
	ErrorDetails  *string   `json:"error_details,omitempty"`
}

type BulkDomainRequest struct {
	DomainIDs []uuid.UUID `json:"domain_ids"`
	Force     bool        `json:"force,omitempty"`
}

type BulkVerifyResult struct {
	Results []BulkVerifyItem `json:"results"`
	Failed  []BulkFailItem   `json:"failed"`
}

type BulkVerifyItem struct {
	DomainID    uuid.UUID `json:"domain_id"`
	DomainName  string    `json:"domain_name"`
	MXVerified  bool      `json:"mx_verified"`
	TXTVerified bool      `json:"txt_verified"`
	SPFVerified bool      `json:"spf_verified"`
	Status      string    `json:"status"`
}

type BulkFailItem struct {
	DomainID uuid.UUID `json:"domain_id"`
	Reason   string    `json:"reason"`
}

type BulkDeleteResult struct {
	DeletedCount int            `json:"deleted_count"`
	Skipped      []BulkFailItem `json:"skipped"`
	Failed       []BulkFailItem `json:"failed"`
}

type TransferDomainInput struct {
	TargetOrgID uuid.UUID `json:"target_org_id"`
}

type TransferResult struct {
	Domain                  *Domain `json:"domain"`
	RemovedAssignmentsCount int     `json:"removed_assignments_count"`
	DeactivatedInboxesCount int     `json:"deactivated_inboxes_count"`
}
