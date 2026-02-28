package domain

import (
	"time"

	"github.com/google/uuid"
)

type Inbox struct {
	ID                 uuid.UUID `json:"id"`
	DomainAssignmentID uuid.UUID `json:"domain_assignment_id"`
	DomainID           uuid.UUID `json:"domain_id"`
	CreatedBy          uuid.UUID `json:"created_by"`
	Address            string    `json:"address"`
	FullAddress        string    `json:"full_address"`
	IsActive           bool      `json:"is_active"`
	ExpiresAt          time.Time `json:"expires_at"`
	CreatedAt          time.Time `json:"created_at"`
	// Joined
	DomainName string `json:"domain_name,omitempty"`
	TeamID     uuid.UUID `json:"team_id,omitempty"`
}

type CreateInboxInput struct {
	CustomAlias *string `json:"custom_alias,omitempty"`
	TTL         *string `json:"ttl,omitempty"`
}
