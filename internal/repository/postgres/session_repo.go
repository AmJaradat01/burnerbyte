package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type SessionRepo struct {
	db database.DBTX
}

func NewSessionRepo(db database.DBTX) *SessionRepo {
	return &SessionRepo{db: db}
}

func (r *SessionRepo) WithTx(tx database.DBTX) *SessionRepo {
	return &SessionRepo{db: tx}
}

func (r *SessionRepo) Create(ctx context.Context, s *domain.Session) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO sessions (id, user_id, refresh_token_hash, token_family, ip_address, user_agent, expires_at, sso_provider_name)
		 VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8)`,
		s.ID, s.UserID, s.RefreshTokenHash, s.TokenFamily, s.IPAddress, s.UserAgent, s.ExpiresAt, s.SSOProviderName,
	)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func (r *SessionRepo) GetByTokenHash(ctx context.Context, hash string) (*domain.Session, error) {
	return r.scanOne(ctx,
		`SELECT id, user_id, refresh_token_hash, token_family, ip_address::text, user_agent,
		        last_used_at, expires_at, revoked, created_at, sso_provider_name
		 FROM sessions WHERE refresh_token_hash = $1`, hash)
}

func (r *SessionRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.Session, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, refresh_token_hash, token_family, ip_address::text, user_agent,
		        last_used_at, expires_at, revoked, created_at, sso_provider_name
		 FROM sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()
		 ORDER BY last_used_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []domain.Session
	for rows.Next() {
		var s domain.Session
		if err := rows.Scan(&s.ID, &s.UserID, &s.RefreshTokenHash, &s.TokenFamily,
			&s.IPAddress, &s.UserAgent, &s.LastUsedAt, &s.ExpiresAt, &s.Revoked, &s.CreatedAt,
			&s.SSOProviderName); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}
	return sessions, nil
}

func (r *SessionRepo) Revoke(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

func (r *SessionRepo) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`, userID)
	if err != nil {
		return fmt.Errorf("revoke all sessions: %w", err)
	}
	return nil
}

func (r *SessionRepo) RevokeAllCount(ctx context.Context, userID uuid.UUID) (int, error) {
	tag, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`, userID)
	if err != nil {
		return 0, fmt.Errorf("revoke all sessions: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *SessionRepo) GetByIDForUser(ctx context.Context, userID, sessionID uuid.UUID) (*domain.Session, error) {
	return r.scanOne(ctx,
		`SELECT id, user_id, refresh_token_hash, token_family, ip_address::text, user_agent,
		        last_used_at, expires_at, revoked, created_at, sso_provider_name
		 FROM sessions WHERE id = $1 AND user_id = $2`, sessionID, userID)
}

func (r *SessionRepo) RevokeAllByUser(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`, userID)
	return err
}

func (r *SessionRepo) RevokeForUser(ctx context.Context, userID, sessionID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE id = $1 AND user_id = $2`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke session for user: %w", err)
	}
	return nil
}

func (r *SessionRepo) RevokeAllExcept(ctx context.Context, userID uuid.UUID, exceptID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE AND id != $2`,
		userID, exceptID)
	if err != nil {
		return fmt.Errorf("revoke all except: %w", err)
	}
	return nil
}

func (r *SessionRepo) RevokeByFamily(ctx context.Context, family uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET revoked = TRUE WHERE token_family = $1`, family)
	if err != nil {
		return fmt.Errorf("revoke family: %w", err)
	}
	return nil
}

func (r *SessionRepo) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET last_used_at = NOW() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("update last used: %w", err)
	}
	return nil
}

func (r *SessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE expires_at < NOW()`)
	if err != nil {
		return 0, fmt.Errorf("delete expired: %w", err)
	}
	return tag.RowsAffected(), nil
}

// CountActiveByUser returns the number of non-revoked, non-expired sessions for a user.
func (r *SessionRepo) CountActiveByUser(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count active sessions: %w", err)
	}
	return count, nil
}

// RevokeOldestExceeding revokes the oldest active sessions for a user,
// keeping only the `keep` most recent sessions active (ordered by last_used_at DESC, created_at DESC).
// Returns the number of sessions revoked. Idempotent: if active count ≤ keep, revokes nothing and returns 0.
// Uses FOR UPDATE SKIP LOCKED to prevent concurrent requests from revoking the same sessions.
func (r *SessionRepo) RevokeOldestExceeding(ctx context.Context, userID uuid.UUID, keep int) (int, error) {
	tag, err := r.db.Exec(ctx,
		`WITH ranked AS (
			SELECT id,
			       ROW_NUMBER() OVER (ORDER BY last_used_at DESC, created_at DESC) AS rn
			FROM sessions
			WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()
			FOR UPDATE SKIP LOCKED
		)
		UPDATE sessions SET revoked = TRUE
		WHERE id IN (SELECT id FROM ranked WHERE rn > $2)`,
		userID, keep,
	)
	if err != nil {
		return 0, fmt.Errorf("revoke oldest exceeding: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *SessionRepo) scanOne(ctx context.Context, query string, args ...any) (*domain.Session, error) {
	var s domain.Session
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&s.ID, &s.UserID, &s.RefreshTokenHash, &s.TokenFamily,
		&s.IPAddress, &s.UserAgent, &s.LastUsedAt, &s.ExpiresAt, &s.Revoked, &s.CreatedAt,
		&s.SSOProviderName,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan session: %w", err)
	}
	return &s, nil
}
