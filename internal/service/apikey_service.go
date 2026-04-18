package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// ValidScopesProvider returns the set of valid API key scopes.
// When nil, the hardcoded legacy scopes are used as fallback.
type ValidScopesProvider func() []string

type APIKeyService struct {
	repo           *postgres.APIKeyRepo
	scopesProvider ValidScopesProvider
}

func NewAPIKeyService(repo *postgres.APIKeyRepo, opts ...func(*APIKeyService)) *APIKeyService {
	s := &APIKeyService{repo: repo}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// WithScopesProvider sets a dynamic scopes provider for API key validation.
func WithScopesProvider(provider ValidScopesProvider) func(*APIKeyService) {
	return func(s *APIKeyService) {
		s.scopesProvider = provider
	}
}

func (s *APIKeyService) isValidScope(scope string) bool {
	if s.scopesProvider != nil {
		for _, valid := range s.scopesProvider() {
			if valid == scope {
				return true
			}
		}
	}
	return false
}

// ValidateIPs validates that each entry is a valid IPv4, IPv6, or CIDR string.
func ValidateIPs(ips []string) error {
	for _, entry := range ips {
		if net.ParseIP(entry) != nil {
			continue
		}
		if _, _, err := net.ParseCIDR(entry); err == nil {
			continue
		}
		return fmt.Errorf("invalid IP/CIDR: %s", entry)
	}
	return nil
}

func (s *APIKeyService) Generate(ctx context.Context, teamID, userID uuid.UUID, input domain.CreateAPIKeyInput) (*domain.APIKey, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if len(input.Scopes) == 0 {
		return nil, fmt.Errorf("at least one scope is required")
	}
	for _, sc := range input.Scopes {
		if !s.isValidScope(sc) {
			return nil, fmt.Errorf("invalid scope: %s", sc)
		}
	}

	if len(input.AllowedIPs) > 0 {
		if err := ValidateIPs(input.AllowedIPs); err != nil {
			return nil, err
		}
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}
	rawKey := "bb_" + hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(rawKey))

	var expiresAt *time.Time
	if input.ExpiresIn != nil {
		d, err := time.ParseDuration(*input.ExpiresIn)
		if err != nil {
			return nil, fmt.Errorf("invalid expires_in")
		}
		if d <= 0 {
			return nil, fmt.Errorf("expires_in must be positive")
		}
		t := time.Now().Add(d)
		expiresAt = &t
	}

	k := &domain.APIKey{
		ID:          uuid.New(),
		TeamID:      teamID,
		CreatedBy:   userID,
		KeyHash:     hex.EncodeToString(hash[:]),
		KeyPrefix:   rawKey[:11],
		Name:        input.Name,
		Description: input.Description,
		Scopes:      input.Scopes,
		IsActive:    true,
		AllowedIPs:  input.AllowedIPs,
		ExpiresAt:   expiresAt,
		RawKey:      rawKey,
	}
	if err := s.repo.Create(ctx, k); err != nil {
		return nil, err
	}
	return k, nil
}

func (s *APIKeyService) Get(ctx context.Context, teamID, keyID uuid.UUID) (*domain.APIKey, error) {
	k, err := s.repo.GetByID(ctx, keyID)
	if err != nil {
		return nil, err
	}
	if k.TeamID != teamID {
		return nil, fmt.Errorf("API key not found")
	}
	return k, nil
}

func (s *APIKeyService) List(ctx context.Context, teamID uuid.UUID, includeRevoked bool, page, perPage int) ([]domain.APIKey, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.repo.ListByTeam(ctx, teamID, includeRevoked, page, perPage)
}

func (s *APIKeyService) Update(ctx context.Context, teamID, keyID uuid.UUID, input domain.UpdateAPIKeyInput) (*domain.APIKey, error) {
	k, err := s.repo.GetByID(ctx, keyID)
	if err != nil {
		return nil, err
	}
	if k.TeamID != teamID {
		return nil, fmt.Errorf("API key not found")
	}
	if k.RevokedAt != nil {
		return nil, fmt.Errorf("cannot modify revoked key")
	}

	// Validate scopes if provided
	if len(input.Scopes) > 0 {
		for _, sc := range input.Scopes {
			if !s.isValidScope(sc) {
				return nil, fmt.Errorf("invalid scope: %s", sc)
			}
		}
	}

	// Validate IPs if provided
	if input.AllowedIPs != nil && len(*input.AllowedIPs) > 0 {
		if err := ValidateIPs(*input.AllowedIPs); err != nil {
			return nil, err
		}
	}

	if err := s.repo.Update(ctx, keyID, input); err != nil {
		return nil, err
	}

	// Return the updated key
	return s.repo.GetByID(ctx, keyID)
}

func (s *APIKeyService) Rotate(ctx context.Context, teamID, keyID uuid.UUID) (*domain.APIKey, error) {
	k, err := s.repo.GetByID(ctx, keyID)
	if err != nil {
		return nil, err
	}
	if k.TeamID != teamID {
		return nil, fmt.Errorf("API key not found")
	}
	if k.RevokedAt != nil {
		return nil, fmt.Errorf("cannot modify revoked key")
	}
	if !k.IsActive {
		return nil, fmt.Errorf("cannot rotate inactive key")
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}
	rawKey := "bb_" + hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(rawKey))
	newHash := hex.EncodeToString(hash[:])
	newPrefix := rawKey[:11]

	if err := s.repo.RotateKey(ctx, keyID, newHash, newPrefix); err != nil {
		return nil, err
	}

	// Return the key with the new raw key (shown once)
	updated, err := s.repo.GetByID(ctx, keyID)
	if err != nil {
		return nil, err
	}
	updated.RawKey = rawKey
	return updated, nil
}

func (s *APIKeyService) Revoke(ctx context.Context, teamID, keyID, userID uuid.UUID) error {
	k, err := s.repo.GetByID(ctx, keyID)
	if err != nil {
		return err
	}
	if k.TeamID != teamID {
		return fmt.Errorf("API key not found")
	}
	return s.repo.SoftRevoke(ctx, keyID, userID)
}

func (s *APIKeyService) BulkRevoke(ctx context.Context, teamID, userID uuid.UUID, input domain.BulkRevokeInput) (*domain.BulkRevokeResult, error) {
	if len(input.KeyIDs) == 0 {
		return nil, fmt.Errorf("key_ids is required")
	}
	revoked, skipped, err := s.repo.BulkSoftRevoke(ctx, teamID, input.KeyIDs, userID)
	if err != nil {
		return nil, err
	}
	if skipped == nil {
		skipped = []uuid.UUID{}
	}
	return &domain.BulkRevokeResult{
		Revoked: revoked,
		Skipped: skipped,
	}, nil
}

func (s *APIKeyService) ValidateAndResolve(ctx context.Context, rawKey string, remoteIP string) (*domain.APIKey, error) {
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	key, err := s.repo.GetByHash(ctx, keyHash)
	if err != nil {
		return nil, fmt.Errorf("invalid API key")
	}

	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return nil, fmt.Errorf("API key expired")
	}

	if key.RevokedAt != nil {
		return nil, fmt.Errorf("API key revoked")
	}

	if !key.IsActive {
		return nil, fmt.Errorf("API key disabled")
	}

	_ = s.repo.UpdateLastUsedWithTracking(ctx, key.ID, remoteIP)
	return key, nil
}
