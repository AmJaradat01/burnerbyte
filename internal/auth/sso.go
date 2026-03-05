package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// SSOManager handles OIDC-based SSO authentication.
type SSOManager struct {
	cfg      *config.Config
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
	lastCfg  config.SSOConfig // track when config changes
}

func NewSSOManager(cfg *config.Config) *SSOManager {
	return &SSOManager{cfg: cfg}
}

func (s *SSOManager) sso() config.SSOConfig { return s.cfg.SSO }

func (s *SSOManager) IsConfigured() bool {
	c := s.sso()
	return c.Provider != "" && c.ClientID != "" && c.ClientSecret != ""
}

func (s *SSOManager) initProvider(ctx context.Context) error {
	c := s.sso()
	// Re-init if config changed
	if s.provider != nil && s.lastCfg == c {
		return nil
	}
	issuer := providerIssuer(c)
	p, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return fmt.Errorf("oidc discovery: %w", err)
	}
	s.provider = p
	s.verifier = p.Verifier(&oidc.Config{ClientID: c.ClientID})
	s.oauth = &oauth2.Config{
		ClientID:     c.ClientID,
		ClientSecret: c.ClientSecret,
		RedirectURL:  c.RedirectURL,
		Endpoint:     p.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	s.lastCfg = c
	return nil
}

// providerIssuer maps short provider names to OIDC issuer URLs.
func providerIssuer(cfg config.SSOConfig) string {
	switch cfg.Provider {
	case "google":
		return "https://accounts.google.com"
	case "github":
		return "https://token.actions.githubusercontent.com"
	case "azure":
		tenant := cfg.TenantID
		if tenant == "" {
			tenant = "common"
		}
		return "https://login.microsoftonline.com/" + tenant + "/v2.0"
	default:
		// okta, oidc, or any custom — use issuer_url or provider as-is
		if cfg.IssuerURL != "" {
			return cfg.IssuerURL
		}
		return cfg.Provider
	}
}

// GenerateState creates a random state parameter for CSRF protection.
func (s *SSOManager) GenerateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// RedirectURL returns the OIDC authorization URL.
func (s *SSOManager) RedirectURL(ctx context.Context, state string) (string, error) {
	if !s.IsConfigured() {
		return "", fmt.Errorf("SSO not configured")
	}
	if err := s.initProvider(ctx); err != nil {
		return "", err
	}
	return s.oauth.AuthCodeURL(state, oauth2.AccessTypeOffline), nil
}

// HandleCallback exchanges the auth code and extracts user info from the ID token.
func (s *SSOManager) HandleCallback(ctx context.Context, r *http.Request) (email, displayName, provider, subject string, err error) {
	if !s.IsConfigured() {
		return "", "", "", "", fmt.Errorf("SSO not configured")
	}
	if err := s.initProvider(ctx); err != nil {
		return "", "", "", "", err
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		return "", "", "", "", fmt.Errorf("missing code parameter")
	}

	token, err := s.oauth.Exchange(ctx, code)
	if err != nil {
		return "", "", "", "", fmt.Errorf("token exchange: %w", err)
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return "", "", "", "", fmt.Errorf("no id_token in response")
	}

	idToken, err := s.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return "", "", "", "", fmt.Errorf("verify id_token: %w", err)
	}

	var claims struct {
		Email   string `json:"email"`
		Name    string `json:"name"`
		Subject string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return "", "", "", "", fmt.Errorf("parse claims: %w", err)
	}

	if claims.Email == "" {
		return "", "", "", "", fmt.Errorf("email claim missing from id_token")
	}

	return claims.Email, claims.Name, s.sso().Provider, claims.Subject, nil
}
