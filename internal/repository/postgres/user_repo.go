package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

var ErrConflict = errors.New("conflict: resource already exists")
var ErrNotFound = errors.New("resource not found")

type UserRepo struct {
	db database.DBTX
}

func NewUserRepo(db database.DBTX) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) WithTx(tx database.DBTX) *UserRepo {
	return &UserRepo{db: tx}
}

func (r *UserRepo) Create(ctx context.Context, u *domain.User) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO users (id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject, is_system_admin, email_verified, password_changed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		u.ID, u.Email, u.DisplayName, u.AvatarURL, u.PasswordHash,
		u.SSOProvider, u.SSOSubject, u.IsSystemAdmin, u.EmailVerified, u.PasswordChangedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (r *UserRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return r.scanOne(ctx,
		`SELECT id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject,
		        is_system_admin, email_verified, password_changed_at, created_at, updated_at
		 FROM users WHERE id = $1`, id)
}

func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return r.scanOne(ctx,
		`SELECT id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject,
		        is_system_admin, email_verified, password_changed_at, created_at, updated_at
		 FROM users WHERE email = $1`, email)
}

func (r *UserRepo) GetBySSO(ctx context.Context, provider, subject string) (*domain.User, error) {
	return r.scanOne(ctx,
		`SELECT id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject,
		        is_system_admin, email_verified, password_changed_at, created_at, updated_at
		 FROM users WHERE sso_provider = $1 AND sso_subject = $2`, provider, subject)
}

func (r *UserRepo) Update(ctx context.Context, u *domain.User) error {
	_, err := r.db.Exec(ctx,
		`UPDATE users SET email=$1, display_name=$2, avatar_url=$3, password_hash=$4,
		 sso_provider=$5, sso_subject=$6, is_system_admin=$7, email_verified=$8, password_changed_at=$9
		 WHERE id=$10`,
		u.Email, u.DisplayName, u.AvatarURL, u.PasswordHash,
		u.SSOProvider, u.SSOSubject, u.IsSystemAdmin, u.EmailVerified, u.PasswordChangedAt, u.ID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("update user: %w", err)
	}
	return nil
}

func (r *UserRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}

func (r *UserRepo) ListAll(ctx context.Context, page, perPage int) ([]domain.User, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}
	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject,
		        is_system_admin, email_verified, password_changed_at, created_at, updated_at
		 FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	var users []domain.User
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.PasswordHash,
			&u.SSOProvider, &u.SSOSubject, &u.IsSystemAdmin, &u.EmailVerified,
			&u.PasswordChangedAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}
	return users, total, nil
}

func (r *UserRepo) scanOne(ctx context.Context, query string, args ...any) (*domain.User, error) {
	var u domain.User
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.PasswordHash,
		&u.SSOProvider, &u.SSOSubject, &u.IsSystemAdmin, &u.EmailVerified,
		&u.PasswordChangedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return &u, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
