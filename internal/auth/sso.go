package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

// SSOManager handles OIDC-based SSO authentication.
type SSOManager struct {
	cfg      config.SSOConfig
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
}

func NewSSOManager(cfg config.SSOConfig) *SSOManager {
	m := &SSOManager{cfg: cfg}
	if !m.IsConfigured() {
		return m
	}
	// Lazy-init provider on first use via initProvider()
	return m
}

func (s *SSOManager) IsConfigured() bool {
	return s.cfg.Provider != "" && s.cfg.ClientID != "" && s.cfg.ClientSecret != ""
}

func (s *SSOManager) initProvider(ctx context.Context) error {
	if s.provider != nil {
		return nil
	}
	p, err := oidc.NewProvider(ctx, s.cfg.Provider)
	if err != nil {
		return fmt.Errorf("oidc discovery: %w", err)
	}
	s.provider = p
	s.verifier = p.Verifier(&oidc.Config{ClientID: s.cfg.ClientID})
	s.oauth = &oauth2.Config{
		ClientID:     s.cfg.ClientID,
		ClientSecret: s.cfg.ClientSecret,
		RedirectURL:  s.cfg.RedirectURL,
		Endpoint:     p.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	return nil
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

	return claims.Email, claims.Name, s.cfg.Provider, claims.Subject, nil
}
