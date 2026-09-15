package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/amjaradat01/burnerbyte/internal/database"
	"github.com/amjaradat01/burnerbyte/internal/domain"
)

type SSOIdentityRepo struct {
	db database.DBTX
}

func NewSSOIdentityRepo(db database.DBTX) *SSOIdentityRepo {
	return &SSOIdentityRepo{db: db}
}

func (r *SSOIdentityRepo) WithTx(tx database.DBTX) *SSOIdentityRepo {
	return &SSOIdentityRepo{db: tx}
}

func (r *SSOIdentityRepo) Create(ctx context.Context, identity *domain.SSOIdentity) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO user_sso_identities (id, user_id, provider, subject, email, display_name, metadata)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		identity.ID, identity.UserID, identity.Provider, identity.Subject,
		identity.Email, identity.DisplayName, identity.Metadata,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create sso identity: %w", err)
	}
	return nil
}

func (r *SSOIdentityRepo) GetByProviderSubject(ctx context.Context, provider, subject string) (*domain.SSOIdentity, error) {
	var i domain.SSOIdentity
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, provider, subject, email, display_name, metadata, linked_at, last_used_at
		 FROM user_sso_identities WHERE provider = $1 AND subject = $2`, provider, subject).
		Scan(&i.ID, &i.UserID, &i.Provider, &i.Subject, &i.Email, &i.DisplayName,
			&i.Metadata, &i.LinkedAt, &i.LastUsedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get sso identity by provider/subject: %w", err)
	}
	return &i, nil
}

func (r *SSOIdentityRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.SSOIdentity, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, provider, subject, email, display_name, metadata, linked_at, last_used_at
		 FROM user_sso_identities WHERE user_id = $1 ORDER BY linked_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sso identities: %w", err)
	}
	defer rows.Close()

	var identities []domain.SSOIdentity
	for rows.Next() {
		var i domain.SSOIdentity
		if err := rows.Scan(&i.ID, &i.UserID, &i.Provider, &i.Subject, &i.Email, &i.DisplayName,
			&i.Metadata, &i.LinkedAt, &i.LastUsedAt); err != nil {
			return nil, fmt.Errorf("scan sso identity: %w", err)
		}
		identities = append(identities, i)
	}
	return identities, rows.Err()
}

func (r *SSOIdentityRepo) GetByUserAndProvider(ctx context.Context, userID uuid.UUID, provider string) (*domain.SSOIdentity, error) {
	var i domain.SSOIdentity
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, provider, subject, email, display_name, metadata, linked_at, last_used_at
		 FROM user_sso_identities WHERE user_id = $1 AND provider = $2`, userID, provider).
		Scan(&i.ID, &i.UserID, &i.Provider, &i.Subject, &i.Email, &i.DisplayName,
			&i.Metadata, &i.LinkedAt, &i.LastUsedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get sso identity by user/provider: %w", err)
	}
	return &i, nil
}

func (r *SSOIdentityRepo) Delete(ctx context.Context, userID uuid.UUID, provider string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM user_sso_identities WHERE user_id = $1 AND provider = $2`, userID, provider)
	if err != nil {
		return fmt.Errorf("delete sso identity: %w", err)
	}
	return nil
}

func (r *SSOIdentityRepo) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE user_sso_identities SET last_used_at = NOW() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("update sso identity last used: %w", err)
	}
	return nil
}
