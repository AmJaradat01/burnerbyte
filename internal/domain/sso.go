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
