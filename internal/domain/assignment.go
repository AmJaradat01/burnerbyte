package domain

import (
	"time"

	"github.com/google/uuid"
)

type DomainAssignment struct {
	ID          uuid.UUID          `json:"id"`
	TeamID      uuid.UUID          `json:"team_id"`
	DomainID    uuid.UUID          `json:"domain_id"`
	AccessLevel string             `json:"access_level"`
	Settings    AssignmentSettings `json:"settings"`
	AssignedBy  *uuid.UUID         `json:"assigned_by,omitempty"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
	// Joined fields
	DomainName string `json:"domain_name,omitempty"`
	// Resolved TTL settings (populated by handler, not DB)
	DefaultTTL string `json:"default_ttl,omitempty"`
	MaxTTL     string `json:"max_ttl,omitempty"`
}

type AssignmentSettings struct {
	AttachmentsEnabled *string `json:"attachments_enabled,omitempty"`
	MaxInboxTTL        *string `json:"max_inbox_ttl,omitempty"`
}

type CreateAssignmentInput struct {
	DomainID    string `json:"domain_id"`
	AccessLevel string `json:"access_level"`
}

type UpdateAssignmentInput struct {
	AccessLevel *string             `json:"access_level,omitempty"`
	Settings    *AssignmentSettings `json:"settings,omitempty"`
}
