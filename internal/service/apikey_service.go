package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type APIKeyService struct {
	repo *postgres.APIKeyRepo
}

func NewAPIKeyService(repo *postgres.APIKeyRepo) *APIKeyService {
	return &APIKeyService{repo: repo}
}

var validScopes = map[string]bool{
	"inbox:create": true, "inbox:read": true, "email:read": true, "email:delete": true,
}

func (s *APIKeyService) Generate(ctx context.Context, teamID, userID uuid.UUID, input domain.CreateAPIKeyInput) (*domain.APIKey, error) {
	if input.Name == "" { return nil, fmt.Errorf("name is required") }
	for _, sc := range input.Scopes {
		if !validScopes[sc] { return nil, fmt.Errorf("invalid scope: %s", sc) }
	}

	raw := make([]byte, 32)
	rand.Read(raw)
	rawKey := "bb_" + hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(rawKey))

	var expiresAt *time.Time
	if input.ExpiresIn != nil {
		d, err := time.ParseDuration(*input.ExpiresIn)
		if err != nil { return nil, fmt.Errorf("invalid expires_in") }
		t := time.Now().Add(d)
		expiresAt = &t
	}

	k := &domain.APIKey{
		ID: uuid.New(), TeamID: teamID, CreatedBy: userID,
		KeyHash: hex.EncodeToString(hash[:]), KeyPrefix: rawKey[:11],
		Name: input.Name, Scopes: input.Scopes, ExpiresAt: expiresAt,
		RawKey: rawKey,
	}
	if err := s.repo.Create(ctx, k); err != nil { return nil, err }
	return k, nil
}

func (s *APIKeyService) List(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.APIKey, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.repo.ListByTeam(ctx, teamID, page, perPage)
}

func (s *APIKeyService) Revoke(ctx context.Context, teamID, id uuid.UUID) error {
	k, err := s.repo.GetByID(ctx, id)
	if err != nil { return err }
	if k.TeamID != teamID { return fmt.Errorf("API key not found") }
	return s.repo.Delete(ctx, id)
}

func (s *APIKeyService) ValidateAndResolve(ctx context.Context, rawKey string) (*domain.APIKey, error) {
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	key, err := s.repo.GetByHash(ctx, keyHash)
	if err != nil {
		return nil, fmt.Errorf("invalid API key")
	}

	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return nil, fmt.Errorf("API key expired")
	}

	_ = s.repo.UpdateLastUsed(ctx, key.ID)
	return key, nil
}
