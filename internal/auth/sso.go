package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

// SSOManager handles OIDC-based SSO authentication.
// Full OIDC integration requires coreos/go-oidc/v3 which will be added
// when an SSO provider is configured. This provides the redirect/callback flow.
type SSOManager struct {
	cfg config.SSOConfig
}

func NewSSOManager(cfg config.SSOConfig) *SSOManager {
	return &SSOManager{cfg: cfg}
}

func (s *SSOManager) IsConfigured() bool {
	return s.cfg.Provider != "" && s.cfg.ClientID != ""
}

// GenerateState creates a random state parameter for CSRF protection.
func (s *SSOManager) GenerateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// RedirectURL returns the OIDC authorization URL for the given provider.
func (s *SSOManager) RedirectURL(_ context.Context, _ string, _ string) (string, error) {
	if !s.IsConfigured() {
		return "", fmt.Errorf("SSO not configured")
	}
	// Full OIDC discovery + redirect will be implemented with coreos/go-oidc/v3
	return "", fmt.Errorf("SSO provider %q not yet implemented", s.cfg.Provider)
}

// HandleCallback processes the OIDC callback and returns user info.
func (s *SSOManager) HandleCallback(_ context.Context, _ *http.Request) (email, displayName, provider, subject string, err error) {
	if !s.IsConfigured() {
		return "", "", "", "", fmt.Errorf("SSO not configured")
	}
	return "", "", "", "", fmt.Errorf("SSO callback not yet implemented")
}
