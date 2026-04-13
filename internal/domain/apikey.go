package domain

import (
	"time"

	"github.com/google/uuid"
)

type APIKey struct {
	ID             uuid.UUID  `json:"id"`
	TeamID         uuid.UUID  `json:"team_id"`
	CreatedBy      uuid.UUID  `json:"created_by"`
	KeyHash        string     `json:"-"`
	KeyPrefix      string     `json:"key_prefix"`
	Name           string     `json:"name"`
	Description    *string    `json:"description,omitempty"`
	Scopes         []string   `json:"scopes"`
	IsActive       bool       `json:"is_active"`
	AllowedIPs     []string   `json:"allowed_ips,omitempty"`
	RequestCount   int64      `json:"request_count"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
	LastUsedIP     *string    `json:"last_used_ip,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	RevokedBy      *uuid.UUID `json:"revoked_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	CreatedByEmail string     `json:"created_by_email,omitempty"`
	CreatedByName  string     `json:"created_by_name,omitempty"`
	RawKey         string     `json:"raw_key,omitempty"` // Only returned on creation/rotation
}

type CreateAPIKeyInput struct {
	Name        string   `json:"name"`
	Description *string  `json:"description,omitempty"`
	Scopes      []string `json:"scopes"`
	ExpiresIn   *string  `json:"expires_in,omitempty"`
	AllowedIPs  []string `json:"allowed_ips,omitempty"`
}

type UpdateAPIKeyInput struct {
	Name        *string   `json:"name,omitempty"`
	Description *string   `json:"description,omitempty"`
	Scopes      []string  `json:"scopes,omitempty"`
	IsActive    *bool     `json:"is_active,omitempty"`
	ExpiresAt   *string   `json:"expires_at,omitempty"`
	AllowedIPs  *[]string `json:"allowed_ips,omitempty"`
}

type BulkRevokeInput struct {
	KeyIDs []uuid.UUID `json:"key_ids"`
}

type BulkRevokeResult struct {
	Revoked int         `json:"revoked"`
	Skipped []uuid.UUID `json:"skipped"`
}
