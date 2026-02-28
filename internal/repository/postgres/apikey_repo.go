package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type APIKeyRepo struct {
	db database.DBTX
}

func NewAPIKeyRepo(db database.DBTX) *APIKeyRepo {
	return &APIKeyRepo{db: db}
}

func (r *APIKeyRepo) Create(ctx context.Context, k *domain.APIKey) error {
	scopes, _ := json.Marshal(k.Scopes)
	_, err := r.db.Exec(ctx,
		`INSERT INTO api_keys (id, team_id, created_by, key_hash, key_prefix, name, scopes, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		k.ID, k.TeamID, k.CreatedBy, k.KeyHash, k.KeyPrefix, k.Name, scopes, k.ExpiresAt)
	if err != nil { return fmt.Errorf("create api key: %w", err) }
	return nil
}

func (r *APIKeyRepo) GetByHash(ctx context.Context, hash string) (*domain.APIKey, error) {
	var k domain.APIKey
	var scopes []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, team_id, created_by, key_hash, key_prefix, name, scopes, last_used_at, expires_at, created_at
		 FROM api_keys WHERE key_hash = $1`, hash).
		Scan(&k.ID, &k.TeamID, &k.CreatedBy, &k.KeyHash, &k.KeyPrefix, &k.Name, &scopes, &k.LastUsedAt, &k.ExpiresAt, &k.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) { return nil, ErrNotFound }
		return nil, err
	}
	json.Unmarshal(scopes, &k.Scopes)
	return &k, nil
}

func (r *APIKeyRepo) ListByTeam(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.APIKey, int, error) {
	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE team_id = $1`, teamID).Scan(&total); err != nil {
		return nil, 0, err
	}
	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, team_id, created_by, key_hash, key_prefix, name, scopes, last_used_at, expires_at, created_at
		 FROM api_keys WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, teamID, perPage, offset)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var keys []domain.APIKey
	for rows.Next() {
		var k domain.APIKey
		var scopes []byte
		if err := rows.Scan(&k.ID, &k.TeamID, &k.CreatedBy, &k.KeyHash, &k.KeyPrefix, &k.Name, &scopes, &k.LastUsedAt, &k.ExpiresAt, &k.CreatedAt); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(scopes, &k.Scopes)
		keys = append(keys, k)
	}
	return keys, total, nil
}

func (r *APIKeyRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

func (r *APIKeyRepo) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}
