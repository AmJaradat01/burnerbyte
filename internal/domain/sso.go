package domain

import (
	"time"

	"github.com/google/uuid"
)

// SSOIdentity represents a user's linked SSO identity.
type SSOIdentity struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	Provider    string    `json:"provider"`
	Subject     string    `json:"subject"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Metadata    any       `json:"metadata,omitempty"`
	LinkedAt    time.Time `json:"linked_at"`
	LastUsedAt  time.Time `json:"last_used_at"`
}

// SSOProvider represents a configured SSO provider stored in the database.
type SSOProvider struct {
	ID                    uuid.UUID      `json:"id"`
	Name                  string         `json:"name"`
	ProviderType          string         `json:"provider_type"`
	ClientID              string         `json:"client_id"`
	ClientSecretEncrypted string         `json:"-"`
	ClientSecret          string         `json:"client_secret,omitempty"`
	RedirectURL           string         `json:"redirect_url"`
	IssuerURL             string         `json:"issuer_url,omitempty"`
	TenantID              string         `json:"tenant_id,omitempty"`
	AutoProvision         bool           `json:"auto_provision"`
	DefaultOrgRole        string         `json:"default_org_role,omitempty"`
	DefaultTeamRole       string         `json:"default_team_role,omitempty"`
	DefaultTeamID         *uuid.UUID     `json:"default_team_id,omitempty"`
	AllowedDomains        string         `json:"allowed_domains,omitempty"`
	ClaimMappings         []ClaimMapping `json:"claim_mappings,omitempty"`
	CustomClaims          []string       `json:"custom_claims,omitempty"`
	Enabled               bool           `json:"enabled"`
	LinkedUserCount       int            `json:"linked_user_count,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

// ClaimMapping maps an IdP claim value to a BurnerByte role/team assignment.
type ClaimMapping struct {
	ClaimName  string `json:"claim_name"`
	ClaimValue string `json:"claim_value"`
	OrgRole    string `json:"org_role"`
	TeamID     string `json:"team_id,omitempty"`
	TeamRole   string `json:"team_role,omitempty"`
}

// SSOCallbackResult holds the extracted data from an SSO callback.
type SSOCallbackResult struct {
	Email       string         `json:"email"`
	DisplayName string         `json:"display_name"`
	Provider    string         `json:"provider"`
	Subject     string         `json:"subject"`
	AvatarURL   string         `json:"avatar_url,omitempty"`
	Claims      map[string]any `json:"claims,omitempty"`
}

// SSOTestResult holds the result of an SSO connection test.
type SSOTestResult struct {
	Success      bool   `json:"success"`
	Endpoint     string `json:"endpoint"`
	StatusCode   int    `json:"status_code,omitempty"`
	Message      string `json:"message"`
	ResponseTime string `json:"response_time"`
}

// SSOStatusResponse is returned by the SSO status endpoint.
type SSOStatusResponse struct {
	Enabled           bool              `json:"enabled"`
	AllowRegistration bool              `json:"allow_registration"`
	EnforceSSO        bool              `json:"enforce_sso"`
	Providers         []SSOStatusProvider `json:"providers"`
	PasswordPolicy    any               `json:"password_policy"`
}

// SSOStatusProvider is a public-facing summary of a configured provider.
type SSOStatusProvider struct {
	Name         string `json:"name"`
	ProviderType string `json:"provider_type"`
	Label        string `json:"label"`
	Enabled      bool   `json:"enabled"`
}

// SSODomainMapping maps an email domain to a team with role assignments.
// Multiple mappings can exist for the same (provider_id, domain) pair with different team_ids,
// enabling one domain rule to route users to multiple teams simultaneously.
type SSODomainMapping struct {
	ID         uuid.UUID `json:"id"`
	ProviderID uuid.UUID `json:"provider_id"`
	Domain     string    `json:"domain"`
	OrgRole    string    `json:"org_role"`
	TeamID     uuid.UUID `json:"team_id"`
	TeamRole   string    `json:"team_role"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	// Enriched fields (not stored, populated on read)
	TeamName string `json:"team_name,omitempty"`
}

// DomainMappingPreviewInput is the request body for the domain mapping dry-run endpoint.
type DomainMappingPreviewInput struct {
	Email    string `json:"email"`
	Provider string `json:"provider"`
}

// DomainMappingPreviewResult shows what would happen if a user with the given email
// authenticated via the given SSO provider.
type DomainMappingPreviewResult struct {
	Email             string                    `json:"email"`
	EmailDomain       string                    `json:"email_domain"`
	Provider          string                    `json:"provider"`
	MatchingRules     []SSODomainMapping        `json:"matching_rules"`
	WouldBypassInvite bool                      `json:"would_bypass_invite"`
	TeamAssignments   []DomainMappingPreviewTeam `json:"team_assignments"`
	OrgRole           string                    `json:"org_role,omitempty"`
}

// DomainMappingPreviewTeam represents a predicted team assignment from a domain mapping preview.
type DomainMappingPreviewTeam struct {
	TeamID   uuid.UUID `json:"team_id"`
	TeamName string    `json:"team_name"`
	TeamRole string    `json:"team_role"`
}
