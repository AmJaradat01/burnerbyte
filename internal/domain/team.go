package domain

import (
	"time"

	"github.com/google/uuid"
)

type Team struct {
	ID        uuid.UUID    `json:"id"`
	OrgID     uuid.UUID    `json:"org_id"`
	Name      string       `json:"name"`
	Slug      string       `json:"slug"`
	Settings  TeamSettings `json:"settings"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
	// Joined counts
	MemberCount   int `json:"member_count"`
	DomainCount   int `json:"domain_count"`
	ActiveInboxes int `json:"active_inboxes"`
}

type TeamSettings struct {
	AttachmentsEnabled *string `json:"attachments_enabled,omitempty"` // "inherit" | "enabled" | "disabled"
	MaxInboxTTL        *string `json:"max_inbox_ttl,omitempty"`
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
	Name string `json:"name"`
}

type UpdateTeamInput struct {
	Name     *string       `json:"name,omitempty"`
	Settings *TeamSettings `json:"settings,omitempty"`
}

type AddTeamMemberInput struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

type ChangeTeamRoleInput struct {
	Role string `json:"role"`
}
