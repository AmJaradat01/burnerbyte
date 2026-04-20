package domain

import (
	"time"

	"github.com/google/uuid"
)

type Organization struct {
	ID        uuid.UUID   `json:"id"`
	Name      string      `json:"name"`
	Slug      string      `json:"slug"`
	LogoURL   *string     `json:"logo_url,omitempty"`
	Settings  OrgSettings `json:"settings"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type OrgSettings struct {
	AttachmentsEnabled  *bool   `json:"attachments_enabled,omitempty"`
	DefaultInboxTTL     *string `json:"default_inbox_ttl,omitempty"`
	MaxInboxTTL         *string `json:"max_inbox_ttl,omitempty"`
	MaxAttachmentSizeMB *int    `json:"max_attachment_size_mb,omitempty"`
	MaxDomains          *int    `json:"max_domains,omitempty"`
	MaxTeams            *int    `json:"max_teams,omitempty"`
	MaxInboxesPerDomain *int    `json:"max_inboxes_per_domain,omitempty"`
	EnforceSSO          *bool   `json:"enforce_sso,omitempty"`
}

type OrgMembership struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	OrgID     uuid.UUID `json:"org_id"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	// Joined fields for list responses
	Email       string     `json:"email,omitempty"`
	DisplayName string     `json:"display_name,omitempty"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

type CreateOrgInput struct {
	Name string `json:"name"`
}

type UpdateOrgInput struct {
	Name    *string `json:"name,omitempty"`
	LogoURL *string `json:"logo_url,omitempty"`
}

type InviteMemberInput struct {
	Email           string             `json:"email"`
	OrgRole         string             `json:"org_role"`
	AllowedAuth     []string           `json:"allowed_auth,omitempty"`
	TeamAssignments []InviteTeamAssign `json:"team_assignments,omitempty"`
	// Deprecated — kept for backward compat
	TeamID   *string `json:"team_id,omitempty"`
	TeamRole *string `json:"team_role,omitempty"`
}

type OrgMemberSuggestion struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
}

type ChangeRoleInput struct {
	Role string `json:"role"`
}

type Invite struct {
	ID              uuid.UUID          `json:"id"`
	OrgID           uuid.UUID          `json:"org_id"`
	Email           string             `json:"email"`
	OrgRole         string             `json:"org_role"`
	AllowedAuth     []string           `json:"allowed_auth"`
	TeamAssignments []InviteTeamAssign `json:"team_assignments"`
	Token           string             `json:"-"`
	InvitedBy       *uuid.UUID         `json:"invited_by,omitempty"`
	AcceptedAt      *time.Time         `json:"accepted_at,omitempty"`
	ExpiresAt       time.Time          `json:"expires_at"`
	CreatedAt       time.Time          `json:"created_at"`
	// Deprecated single-team fields kept for backward compat
	TeamID   *uuid.UUID `json:"team_id,omitempty"`
	TeamRole *string    `json:"team_role,omitempty"`
	// Joined/enriched fields
	TeamName string `json:"team_name,omitempty"`
}

// InviteTeamAssign represents a single team assignment within an invite.
type InviteTeamAssign struct {
	TeamID   uuid.UUID `json:"team_id"`
	TeamRole string    `json:"team_role"`
	// Enriched fields (not stored, populated on read)
	TeamName string `json:"team_name,omitempty"`
}

// BulkInviteMemberInput represents a batch invite request where all invites
// share the same allowed_auth and team_assignments configuration.
type BulkInviteMemberInput struct {
	Emails          []string           `json:"emails"`
	OrgRole         string             `json:"org_role"`
	AllowedAuth     []string           `json:"allowed_auth,omitempty"`
	TeamAssignments []InviteTeamAssign `json:"team_assignments,omitempty"`
}

// BulkInviteResult summarizes the outcome of a bulk invite operation.
type BulkInviteResult struct {
	Created int                 `json:"created"`
	Skipped []BulkInviteSkipped `json:"skipped"`
	Failed  []BulkInviteFailed  `json:"failed"`
}

// BulkInviteSkipped represents an email that was skipped during bulk invite.
type BulkInviteSkipped struct {
	Email  string `json:"email"`
	Reason string `json:"reason"`
}

// BulkInviteFailed represents an email that failed validation during bulk invite.
type BulkInviteFailed struct {
	Email  string `json:"email"`
	Reason string `json:"reason"`
}
