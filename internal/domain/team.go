package domain

import (
	"time"

	"github.com/google/uuid"
)

type Team struct {
	ID          uuid.UUID    `json:"id"`
	OrgID       uuid.UUID    `json:"org_id"`
	Name        string       `json:"name"`
	Slug        string       `json:"slug"`
	Description *string      `json:"description,omitempty"`
	IsArchived  bool         `json:"is_archived"`
	ArchivedAt  *time.Time   `json:"archived_at,omitempty"`
	Settings    TeamSettings `json:"settings"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	// Joined counts (list endpoint)
	MemberCount   int `json:"member_count"`
	DomainCount   int `json:"domain_count"`
	ActiveInboxes int `json:"active_inboxes"`
}

type TeamDetail struct {
	Team
	TotalInboxes        int   `json:"total_inboxes"`
	EmailCount          int   `json:"email_count"`
	WebhookCount        int   `json:"webhook_count"`
	APIKeyCount         int   `json:"apikey_count"`
	TotalEmailsReceived int64 `json:"total_emails_received"`
}

type TeamSettings struct {
	AttachmentsEnabled  *string `json:"attachments_enabled,omitempty"`
	MaxInboxTTL         *string `json:"max_inbox_ttl,omitempty"`
	DefaultInboxTTL     *string `json:"default_inbox_ttl,omitempty"`
	MaxInboxesPerDomain *int    `json:"max_inboxes_per_domain,omitempty"`
}

type TeamMembership struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	TeamID      uuid.UUID `json:"team_id"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
	Email       string    `json:"email,omitempty"`
	DisplayName string    `json:"display_name,omitempty"`
}

type CreateTeamInput struct {
	Name        string                  `json:"name"`
	Description *string                 `json:"description,omitempty"`
	Members     []AddTeamMemberInput    `json:"members,omitempty"`
	Domains     []CreateTeamDomainInput `json:"domains,omitempty"`
}

type CreateTeamDomainInput struct {
	DomainID    string `json:"domain_id"`
	AccessLevel string `json:"access_level"`
}

type UpdateTeamInput struct {
	Name        *string       `json:"name,omitempty"`
	Description *string       `json:"description,omitempty"`
	Settings    *TeamSettings `json:"settings,omitempty"`
}

type AddTeamMemberInput struct {
	UserID string `json:"user_id,omitempty"`
	Email  string `json:"email,omitempty"`
	Role   string `json:"role"`
}

type ChangeTeamRoleInput struct {
	Role string `json:"role"`
}

type BulkAddMembersInput struct {
	Members []AddTeamMemberInput `json:"members"`
}

type BulkRemoveMembersInput struct {
	UserIDs []uuid.UUID `json:"user_ids"`
}

type BulkMemberResult struct {
	AddedCount   int                 `json:"added_count,omitempty"`
	RemovedCount int                 `json:"removed_count,omitempty"`
	Skipped      []BulkMemberSkipped `json:"skipped"`
	Failed       []BulkMemberFailed  `json:"failed,omitempty"`
}

type BulkMemberSkipped struct {
	Identifier string `json:"identifier"`
	Reason     string `json:"reason"`
}

type BulkMemberFailed struct {
	Identifier string `json:"identifier"`
	Reason     string `json:"reason"`
}

type TeamImpact struct {
	MemberCount           int `json:"member_count"`
	InboxCount            int `json:"inbox_count"`
	ActiveInboxCount      int `json:"active_inbox_count"`
	EmailCount            int `json:"email_count"`
	DomainAssignmentCount int `json:"domain_assignment_count"`
	WebhookCount          int `json:"webhook_count"`
	APIKeyCount           int `json:"apikey_count"`
}

type TransferTeamInput struct {
	TargetOrgID uuid.UUID `json:"target_org_id"`
}

type TransferTeamResult struct {
	Team           *Team             `json:"team"`
	RemovedMembers []TransferRemoved `json:"removed_members"`
}

type TransferRemoved struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
}

type CreateTeamResult struct {
	Team            *Team              `json:"team"`
	FailedMembers   []BulkMemberFailed `json:"failed_members,omitempty"`
	FailedDomains   []BulkDomainFailed `json:"failed_domains,omitempty"`
	AssignedDomains int                `json:"assigned_domains"`
}

type BulkDomainFailed struct {
	DomainID string `json:"domain_id"`
	Reason   string `json:"reason"`
}
