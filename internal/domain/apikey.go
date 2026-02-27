package domain

import (
	"time"

	"github.com/google/uuid"
)

type APIKey struct {
	ID         uuid.UUID  `json:"id"`
	TeamID     uuid.UUID  `json:"team_id"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	KeyHash    string     `json:"-"`
	KeyPrefix  string     `json:"key_prefix"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	RawKey     string     `json:"raw_key,omitempty"` // Only returned on creation
}

type CreateAPIKeyInput struct {
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresIn *string  `json:"expires_in,omitempty"`
}
