package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	appcrypto "gitlab.com/burnerbyte/burnerbyte/internal/crypto"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// providerState holds the initialized state for a single SSO provider.
type providerState struct {
	config   domain.SSOProvider
	oidcProv *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
}

// SSOManager handles multi-provider SSO authentication.
type SSOManager struct {
	cfg       *config.Config
	encryptor *appcrypto.Encryptor
	providers map[string]*providerState
	mu        sync.RWMutex
}

func NewSSOManager(cfg *config.Config, encryptor *appcrypto.Encryptor) *SSOManager {
	return &SSOManager{
		cfg:       cfg,
		encryptor: encryptor,
		providers: make(map[string]*providerState),
	}
}

// LoadProviders initializes provider states from database + file config merge.
func (s *SSOManager) LoadProviders(ctx context.Context, dbProviders []domain.SSOProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()

	newProviders := make(map[string]*providerState)

	// Load database providers first (they take precedence)
	for _, p := range dbProviders {
		ps, err := s.initProviderState(ctx, p)
		if err != nil {
			slog.Warn("failed to init SSO provider", "name", p.Name, "error", err)
			continue
		}
		newProviders[p.Name] = ps
	}

	// Merge file-based config as fallback if no DB provider with same name
	fileCfg := s.cfg.SSO
	if fileCfg.Provider != "" && fileCfg.ClientID != "" && fileCfg.ClientSecret != "" {
		if _, exists := newProviders[fileCfg.Provider]; !exists {
			fileProvider := domain.SSOProvider{
				Name:            fileCfg.Provider,
				ProviderType:    fileCfg.Provider,
				ClientID:        fileCfg.ClientID,
				ClientSecret:    fileCfg.ClientSecret,
				RedirectURL:     fileCfg.RedirectURL,
				IssuerURL:       fileCfg.IssuerURL,
				TenantID:        fileCfg.TenantID,
				AutoProvision:   fileCfg.AutoProvision,
				DefaultOrgRole:  fileCfg.DefaultOrgRole,
				DefaultTeamRole: fileCfg.DefaultTeamRole,
				AllowedDomains:  fileCfg.AllowedDomains,
				Enabled:         true,
			}
			ps, err := s.initProviderState(ctx, fileProvider)
			if err != nil {
				slog.Warn("failed to init file-based SSO provider", "name", fileCfg.Provider, "error", err)
			} else {
				newProviders[fileCfg.Provider] = ps
			}
		}
	}

	s.providers = newProviders
	slog.Info("SSO providers loaded", "count", len(newProviders))
}

func (s *SSOManager) initProviderState(ctx context.Context, p domain.SSOProvider) (*providerState, error) {
	ps := &providerState{config: p}

	if p.ProviderType == "github" {
		// GitHub uses OAuth2, not OIDC discovery
		ps.oauth = &oauth2.Config{
			ClientID:     p.ClientID,
			ClientSecret: p.ClientSecret,
			RedirectURL:  p.RedirectURL,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://github.com/login/oauth/authorize",
				TokenURL: "https://github.com/login/oauth/access_token",
			},
			Scopes: []string{"user:email", "read:user"},
		}
		return ps, nil
	}

	// OIDC-based providers
	issuer := providerIssuer(p)
	oidcProv, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery for %s: %w", p.Name, err)
	}
	ps.oidcProv = oidcProv
	ps.verifier = oidcProv.Verifier(&oidc.Config{ClientID: p.ClientID})
	ps.oauth = &oauth2.Config{
		ClientID:     p.ClientID,
		ClientSecret: p.ClientSecret,
		RedirectURL:  p.RedirectURL,
		Endpoint:     oidcProv.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	return ps, nil
}

// providerIssuer maps provider types to OIDC issuer URLs.
func providerIssuer(p domain.SSOProvider) string {
	switch p.ProviderType {
	case "google":
		return "https://accounts.google.com"
	case "azure":
		tenant := p.TenantID
		if tenant == "" {
			tenant = "common"
		}
		return "https://login.microsoftonline.com/" + tenant + "/v2.0"
	default:
		// okta, oidc, or any custom — use issuer_url
		if p.IssuerURL != "" {
			return p.IssuerURL
		}
		return p.Name
	}
}

// IsConfigured returns true if any provider is in the map.
func (s *SSOManager) IsConfigured() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.providers) > 0
}

// IsProviderConfigured checks if a specific provider exists and is enabled.
func (s *SSOManager) IsProviderConfigured(name string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ps, ok := s.providers[name]
	return ok && ps.config.Enabled
}

// ListProviders returns a public-facing list of all configured providers.
func (s *SSOManager) ListProviders() []domain.SSOStatusProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var providers []domain.SSOStatusProvider
	for _, ps := range s.providers {
		providers = append(providers, domain.SSOStatusProvider{
			Name:         ps.config.Name,
			ProviderType: ps.config.ProviderType,
			Label:        providerLabel(ps.config.ProviderType, ps.config.Name),
			Enabled:      ps.config.Enabled,
		})
	}
	return providers
}

func providerLabel(providerType, name string) string {
	labels := map[string]string{
		"google": "Google",
		"github": "GitHub",
		"azure":  "Microsoft",
		"okta":   "Okta",
		"oidc":   "SSO",
	}
	if l, ok := labels[providerType]; ok {
		return l
	}
	return name
}

// GetProviderConfig returns the provider config for a given name.
func (s *SSOManager) GetProviderConfig(name string) (*domain.SSOProvider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ps, ok := s.providers[name]
	if !ok {
		return nil, fmt.Errorf("SSO provider %q not configured", name)
	}
	return &ps.config, nil
}

// GenerateState creates a random state parameter for CSRF protection.
func (s *SSOManager) GenerateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// RedirectURL returns the authorization URL for the given provider.
func (s *SSOManager) RedirectURL(ctx context.Context, providerName, state string) (string, error) {
	s.mu.RLock()
	ps, ok := s.providers[providerName]
	s.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("SSO provider %q not configured", providerName)
	}
	if !ps.config.Enabled {
		return "", fmt.Errorf("SSO provider %q is disabled", providerName)
	}

	if ps.config.ProviderType == "github" {
		// Build GitHub OAuth2 authorize URL manually
		// Include prompt=login to force GitHub to show the login/account picker
		// instead of silently reusing a cached session
		params := url.Values{
			"client_id":    {ps.config.ClientID},
			"redirect_uri": {ps.config.RedirectURL},
			"scope":        {"user:email read:user"},
			"state":        {state},
			"prompt":       {"login"},
		}
		return "https://github.com/login/oauth/authorize?" + params.Encode(), nil
	}

	return ps.oauth.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "select_account")), nil
}

// HandleCallback processes the SSO callback for the given provider.
func (s *SSOManager) HandleCallback(ctx context.Context, providerName string, r *http.Request) (*domain.SSOCallbackResult, error) {
	s.mu.RLock()
	ps, ok := s.providers[providerName]
	s.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("SSO provider %q not configured", providerName)
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		return nil, fmt.Errorf("missing code parameter")
	}

	if ps.config.ProviderType == "github" {
		return s.handleGitHubCallback(ctx, ps, code)
	}
	return s.handleOIDCCallback(ctx, ps, code)
}

// handleGitHubCallback implements the GitHub OAuth2 flow.
func (s *SSOManager) handleGitHubCallback(ctx context.Context, ps *providerState, code string) (*domain.SSOCallbackResult, error) {
	// Exchange code for access token
	data := url.Values{
		"client_id":     {ps.config.ClientID},
		"client_secret": {ps.config.ClientSecret},
		"code":          {code},
		"redirect_uri":  {ps.config.RedirectURL},
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GitHub token exchange failed: %w", err)
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("decode GitHub token response: %w", err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("GitHub token exchange error: %s — %s", tokenResp.Error, tokenResp.ErrorDesc)
	}
	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("GitHub token exchange returned empty access token")
	}

	// Fetch user info
	userReq, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, fmt.Errorf("create user request: %w", err)
	}
	userReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
	userReq.Header.Set("Accept", "application/json")

	userResp, err := http.DefaultClient.Do(userReq)
	if err != nil {
		return nil, fmt.Errorf("GitHub user API failed: %w", err)
	}
	defer userResp.Body.Close()

	if userResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(userResp.Body)
		return nil, fmt.Errorf("GitHub user API returned %d: %s", userResp.StatusCode, string(body))
	}

	var ghUser struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		Email     string `json:"email"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.NewDecoder(userResp.Body).Decode(&ghUser); err != nil {
		return nil, fmt.Errorf("decode GitHub user response: %w", err)
	}

	email := ghUser.Email
	if email == "" {
		// Fetch emails as fallback
		var fetchErr error
		email, fetchErr = s.fetchGitHubPrimaryEmail(ctx, tokenResp.AccessToken)
		if fetchErr != nil {
			return nil, fmt.Errorf("GitHub email fetch failed: %w", fetchErr)
		}
	}

	if email == "" {
		return nil, fmt.Errorf("no verified email found on GitHub account")
	}

	displayName := ghUser.Name
	if displayName == "" {
		displayName = ghUser.Login
	}

	return &domain.SSOCallbackResult{
		Email:       email,
		DisplayName: displayName,
		Provider:    ps.config.Name,
		Subject:     strconv.FormatInt(ghUser.ID, 10),
		AvatarURL:   ghUser.AvatarURL,
		Claims: map[string]any{
			"login":      ghUser.Login,
			"avatar_url": ghUser.AvatarURL,
		},
	}, nil
}

func (s *SSOManager) fetchGitHubPrimaryEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", err
	}

	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	// Fallback to any verified email
	for _, e := range emails {
		if e.Verified {
			return e.Email, nil
		}
	}
	return "", nil
}

// handleOIDCCallback implements the standard OIDC callback flow.
func (s *SSOManager) handleOIDCCallback(ctx context.Context, ps *providerState, code string) (*domain.SSOCallbackResult, error) {
	token, err := ps.oauth.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, fmt.Errorf("no id_token in response")
	}

	idToken, err := ps.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("verify id_token: %w", err)
	}

	claims := s.extractClaims(idToken, ps.config.CustomClaims)

	email, _ := claims["email"].(string)
	if email == "" {
		return nil, fmt.Errorf("email claim missing from id_token")
	}

	displayName, _ := claims["name"].(string)
	if displayName == "" {
		givenName, _ := claims["given_name"].(string)
		familyName, _ := claims["family_name"].(string)
		if givenName != "" || familyName != "" {
			displayName = strings.TrimSpace(givenName + " " + familyName)
		}
	}

	subject, _ := claims["sub"].(string)
	avatarURL, _ := claims["picture"].(string)

	return &domain.SSOCallbackResult{
		Email:       email,
		DisplayName: displayName,
		Provider:    ps.config.Name,
		Subject:     subject,
		AvatarURL:   avatarURL,
		Claims:      claims,
	}, nil
}

// extractClaims extracts standard + custom claims from an ID token.
func (s *SSOManager) extractClaims(idToken *oidc.IDToken, customClaims []string) map[string]any {
	var allClaims map[string]any
	if err := idToken.Claims(&allClaims); err != nil {
		return map[string]any{}
	}

	result := make(map[string]any)

	// Standard claims
	standardClaims := []string{"email", "name", "given_name", "family_name", "picture", "locale", "sub"}
	for _, key := range standardClaims {
		if v, ok := allClaims[key]; ok {
			result[key] = v
		}
	}

	// Custom claims
	for _, key := range customClaims {
		if v, ok := allClaims[key]; ok {
			result[key] = v
		}
	}

	return result
}

// TestConnection performs a dry-run validation of an SSO provider configuration.
func (s *SSOManager) TestConnection(ctx context.Context, provider domain.SSOProvider) (*domain.SSOTestResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	start := time.Now()

	if provider.ProviderType == "github" {
		endpoint := "https://github.com/login/oauth/authorize"
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		if err != nil {
			return &domain.SSOTestResult{
				Success:      false,
				Endpoint:     endpoint,
				Message:      fmt.Sprintf("failed to create request: %v", err),
				ResponseTime: time.Since(start).Round(time.Millisecond).String(),
			}, nil
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return &domain.SSOTestResult{
				Success:      false,
				Endpoint:     endpoint,
				Message:      fmt.Sprintf("connection failed: %v", err),
				ResponseTime: time.Since(start).Round(time.Millisecond).String(),
			}, nil
		}
		defer resp.Body.Close()
		return &domain.SSOTestResult{
			Success:      resp.StatusCode == http.StatusOK,
			Endpoint:     endpoint,
			StatusCode:   resp.StatusCode,
			Message:      "GitHub OAuth2 endpoint reachable",
			ResponseTime: time.Since(start).Round(time.Millisecond).String(),
		}, nil
	}

	// OIDC providers — test discovery endpoint
	issuer := providerIssuer(provider)
	endpoint := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return &domain.SSOTestResult{
			Success:      false,
			Endpoint:     endpoint,
			Message:      fmt.Sprintf("failed to create request: %v", err),
			ResponseTime: time.Since(start).Round(time.Millisecond).String(),
		}, nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &domain.SSOTestResult{
			Success:      false,
			Endpoint:     endpoint,
			Message:      fmt.Sprintf("connection failed: %v", err),
			ResponseTime: time.Since(start).Round(time.Millisecond).String(),
		}, nil
	}
	defer resp.Body.Close()

	success := resp.StatusCode == http.StatusOK
	msg := "OIDC discovery endpoint reachable"
	if !success {
		msg = fmt.Sprintf("OIDC discovery returned HTTP %d", resp.StatusCode)
	}

	return &domain.SSOTestResult{
		Success:      success,
		Endpoint:     endpoint,
		StatusCode:   resp.StatusCode,
		Message:      msg,
		ResponseTime: time.Since(start).Round(time.Millisecond).String(),
	}, nil
}
