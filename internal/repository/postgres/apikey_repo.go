package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/amjaradat01/burnerbyte/internal/database"
	"github.com/amjaradat01/burnerbyte/internal/domain"
)

type APIKeyRepo struct {
	db database.DBTX
}

func NewAPIKeyRepo(db database.DBTX) *APIKeyRepo {
	return &APIKeyRepo{db: db}
}

func (r *APIKeyRepo) Create(ctx context.Context, k *domain.APIKey) error {
	scopes, _ := json.Marshal(k.Scopes)
	var allowedIPs []byte
	if len(k.AllowedIPs) > 0 {
		allowedIPs, _ = json.Marshal(k.AllowedIPs)
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO api_keys (id, team_id, created_by, key_hash, key_prefix, name, description, scopes, is_active, allowed_ips, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		k.ID, k.TeamID, k.CreatedBy, k.KeyHash, k.KeyPrefix, k.Name, k.Description, scopes, k.IsActive, allowedIPs, k.ExpiresAt)
	if err != nil {
		return fmt.Errorf("create api key: %w", err)
	}
	return nil
}

func (r *APIKeyRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.APIKey, error) {
	var k domain.APIKey
	var scopes []byte
	var allowedIPs []byte
	err := r.db.QueryRow(ctx,
		`SELECT a.id, a.team_id, a.created_by, a.key_hash, a.key_prefix, a.name, a.description,
		        a.scopes, a.is_active, a.allowed_ips, a.request_count, a.last_used_at, a.last_used_ip,
		        a.expires_at, a.revoked_at, a.revoked_by, a.created_at,
		        u.email, u.display_name
		 FROM api_keys a
		 JOIN users u ON u.id = a.created_by
		 WHERE a.id = $1`, id).
		Scan(&k.ID, &k.TeamID, &k.CreatedBy, &k.KeyHash, &k.KeyPrefix, &k.Name, &k.Description,
			&scopes, &k.IsActive, &allowedIPs, &k.RequestCount, &k.LastUsedAt, &k.LastUsedIP,
			&k.ExpiresAt, &k.RevokedAt, &k.RevokedBy, &k.CreatedAt,
			&k.CreatedByEmail, &k.CreatedByName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(scopes, &k.Scopes)
	if allowedIPs != nil {
		_ = json.Unmarshal(allowedIPs, &k.AllowedIPs)
	}
	return &k, nil
}

func (r *APIKeyRepo) GetByHash(ctx context.Context, hash string) (*domain.APIKey, error) {
	var k domain.APIKey
	var scopes []byte
	var allowedIPs []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, team_id, created_by, key_hash, key_prefix, name, description,
		        scopes, is_active, allowed_ips, request_count, last_used_at, last_used_ip,
		        expires_at, revoked_at, revoked_by, created_at
		 FROM api_keys WHERE key_hash = $1`, hash).
		Scan(&k.ID, &k.TeamID, &k.CreatedBy, &k.KeyHash, &k.KeyPrefix, &k.Name, &k.Description,
			&scopes, &k.IsActive, &allowedIPs, &k.RequestCount, &k.LastUsedAt, &k.LastUsedIP,
			&k.ExpiresAt, &k.RevokedAt, &k.RevokedBy, &k.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(scopes, &k.Scopes)
	if allowedIPs != nil {
		_ = json.Unmarshal(allowedIPs, &k.AllowedIPs)
	}
	return &k, nil
}

func (r *APIKeyRepo) ListByTeam(ctx context.Context, teamID uuid.UUID, includeRevoked bool, page, perPage int) ([]domain.APIKey, int, error) {
	revokedFilter := ""
	if !includeRevoked {
		revokedFilter = " AND a.revoked_at IS NULL"
	}

	var total int
	countQuery := `SELECT COUNT(*) FROM api_keys a WHERE a.team_id = $1` + revokedFilter
	if err := r.db.QueryRow(ctx, countQuery, teamID).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	selectQuery := `SELECT a.id, a.team_id, a.created_by, a.key_hash, a.key_prefix, a.name, a.description,
	                       a.scopes, a.is_active, a.allowed_ips, a.request_count, a.last_used_at, a.last_used_ip,
	                       a.expires_at, a.revoked_at, a.revoked_by, a.created_at,
	                       u.email, u.display_name
	                FROM api_keys a
	                JOIN users u ON u.id = a.created_by
	                WHERE a.team_id = $1` + revokedFilter + `
	                ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, selectQuery, teamID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var keys []domain.APIKey
	for rows.Next() {
		var k domain.APIKey
		var scopes []byte
		var allowedIPs []byte
		if err := rows.Scan(&k.ID, &k.TeamID, &k.CreatedBy, &k.KeyHash, &k.KeyPrefix, &k.Name, &k.Description,
			&scopes, &k.IsActive, &allowedIPs, &k.RequestCount, &k.LastUsedAt, &k.LastUsedIP,
			&k.ExpiresAt, &k.RevokedAt, &k.RevokedBy, &k.CreatedAt,
			&k.CreatedByEmail, &k.CreatedByName); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(scopes, &k.Scopes)
		if allowedIPs != nil {
			_ = json.Unmarshal(allowedIPs, &k.AllowedIPs)
		}
		keys = append(keys, k)
	}
	return keys, total, nil
}

func (r *APIKeyRepo) Update(ctx context.Context, id uuid.UUID, input domain.UpdateAPIKeyInput) error {
	setClauses := []string{}
	args := []any{}
	argIdx := 1

	if input.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *input.Name)
		argIdx++
	}
	if input.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *input.Description)
		argIdx++
	}
	if len(input.Scopes) > 0 {
		scopesJSON, _ := json.Marshal(input.Scopes)
		setClauses = append(setClauses, fmt.Sprintf("scopes = $%d", argIdx))
		args = append(args, scopesJSON)
		argIdx++
	}
	if input.IsActive != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_active = $%d", argIdx))
		args = append(args, *input.IsActive)
		argIdx++
	}
	if input.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *input.ExpiresAt)
		if err != nil {
			return fmt.Errorf("invalid expires_at format: %w", err)
		}
		setClauses = append(setClauses, fmt.Sprintf("expires_at = $%d", argIdx))
		args = append(args, t)
		argIdx++
	}
	if input.AllowedIPs != nil {
		var ipsJSON []byte
		if len(*input.AllowedIPs) > 0 {
			ipsJSON, _ = json.Marshal(*input.AllowedIPs)
		}
		setClauses = append(setClauses, fmt.Sprintf("allowed_ips = $%d", argIdx))
		args = append(args, ipsJSON)
		argIdx++
	}

	if len(setClauses) == 0 {
		return fmt.Errorf("no fields to update")
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE api_keys SET %s WHERE id = $%d", strings.Join(setClauses, ", "), argIdx)
	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update api key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *APIKeyRepo) SoftRevoke(ctx context.Context, id uuid.UUID, revokedBy uuid.UUID) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE api_keys SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1`,
		id, revokedBy)
	if err != nil {
		return fmt.Errorf("soft revoke api key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *APIKeyRepo) BulkSoftRevoke(ctx context.Context, teamID uuid.UUID, ids []uuid.UUID, revokedBy uuid.UUID) (int, []uuid.UUID, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE api_keys SET revoked_at = NOW(), revoked_by = $1
		 WHERE id = ANY($2) AND team_id = $3 AND revoked_at IS NULL`,
		revokedBy, ids, teamID)
	if err != nil {
		return 0, nil, fmt.Errorf("bulk soft revoke: %w", err)
	}

	revoked := int(tag.RowsAffected())

	// Determine skipped IDs: those not affected
	var skipped []uuid.UUID
	if revoked < len(ids) {
		// Query which IDs were NOT updated (wrong team or already revoked)
		rows, err := r.db.Query(ctx,
			`SELECT id FROM api_keys
			 WHERE id = ANY($1) AND (team_id != $2 OR revoked_at IS NOT NULL)`,
			ids, teamID)
		if err != nil {
			return revoked, nil, nil // best effort
		}
		defer rows.Close()
		seen := make(map[uuid.UUID]bool)
		for rows.Next() {
			var sid uuid.UUID
			if err := rows.Scan(&sid); err == nil {
				seen[sid] = true
			}
		}
		// Also include IDs that don't exist at all
		for _, id := range ids {
			if !seen[id] {
				// Check if it was one of the revoked ones by checking if it exists and belongs to team
				// Simpler: just check if it's in the DB at all
				var exists bool
				_ = r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM api_keys WHERE id = $1 AND team_id = $2 AND revoked_by = $3)`, id, teamID, revokedBy).Scan(&exists)
				if !exists {
					skipped = append(skipped, id)
				}
			} else {
				skipped = append(skipped, id)
			}
		}
	}

	return revoked, skipped, nil
}

func (r *APIKeyRepo) RotateKey(ctx context.Context, id uuid.UUID, newHash, newPrefix string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE api_keys SET key_hash = $2, key_prefix = $3 WHERE id = $1`,
		id, newHash, newPrefix)
	if err != nil {
		return fmt.Errorf("rotate api key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *APIKeyRepo) UpdateLastUsedWithTracking(ctx context.Context, id uuid.UUID, ip string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE api_keys SET last_used_at = NOW(), request_count = request_count + 1, last_used_ip = $2 WHERE id = $1`,
		id, ip)
	return err
}

// UpdateLastUsed is deprecated — use UpdateLastUsedWithTracking instead.
func (r *APIKeyRepo) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}

// Delete is deprecated — use SoftRevoke instead.
func (r *APIKeyRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

func (r *APIKeyRepo) DeleteExpiredKeys(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM api_keys
		 WHERE (expires_at < NOW() AND revoked_at IS NOT NULL)
		    OR (expires_at < NOW() - INTERVAL '30 days')`)
	if err != nil {
		return 0, fmt.Errorf("delete expired api keys: %w", err)
	}
	return tag.RowsAffected(), nil
}
