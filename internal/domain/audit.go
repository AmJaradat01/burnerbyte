package domain

import (
	"time"

	"github.com/google/uuid"
)

type AuditEntry struct {
	ID               uuid.UUID  `json:"id"`
	OrgID            uuid.UUID  `json:"org_id"`
	ActorID          *uuid.UUID `json:"actor_id,omitempty"`
	ActorEmail       string     `json:"actor_email,omitempty"`
	ActorDisplayName string     `json:"actor_display_name,omitempty"`
	Action           string     `json:"action"`
	ResourceType     string     `json:"resource_type"`
	ResourceID       uuid.UUID  `json:"resource_id"`
	ResourceName     string     `json:"resource_name,omitempty"`
	Metadata         any        `json:"metadata,omitempty"`
	IPAddress        *string    `json:"ip_address,omitempty"`
	UserAgent        string     `json:"user_agent,omitempty"`
	Severity         string     `json:"severity,omitempty"`
	Category         string     `json:"category,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

type AuditFilter struct {
	ActorID      *uuid.UUID `json:"actor_id,omitempty"`
	ActorEmail   *string    `json:"actor_email,omitempty"`
	Action       *string    `json:"action,omitempty"`
	ResourceType *string    `json:"resource_type,omitempty"`
	DateFrom     *time.Time `json:"date_from,omitempty"`
	DateTo       *time.Time `json:"date_to,omitempty"`
	Severity     *string    `json:"severity,omitempty"`
	Category     *string    `json:"category,omitempty"`
	ResourceName *string    `json:"resource_name,omitempty"`
}
