package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gitlab.com/burnerbyte/burnerbyte/internal/database"
)

type EmailVerificationToken struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

type EmailVerificationRepo struct {
	db database.DBTX
}

func NewEmailVerificationRepo(db database.DBTX) *EmailVerificationRepo {
	return &EmailVerificationRepo{db: db}
}

func (r *EmailVerificationRepo) Create(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, expiresAt)
	return err
}

func (r *EmailVerificationRepo) Consume(ctx context.Context, tokenHash string) (*EmailVerificationToken, error) {
	var t EmailVerificationToken
	err := r.db.QueryRow(ctx,
		`UPDATE email_verification_tokens
		 SET used_at = now()
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		 RETURNING id, user_id, token_hash, expires_at, used_at, created_at`,
		tokenHash).Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *EmailVerificationRepo) InvalidateForUser(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
		userID)
	return err
}

func (r *EmailVerificationRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM email_verification_tokens WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
