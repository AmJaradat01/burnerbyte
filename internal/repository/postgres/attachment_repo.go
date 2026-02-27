package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type AttachmentRepo struct {
	db database.DBTX
}

func NewAttachmentRepo(db database.DBTX) *AttachmentRepo {
	return &AttachmentRepo{db: db}
}

func (r *AttachmentRepo) Create(ctx context.Context, a *domain.Attachment) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO attachments (id, email_id, filename, content_type, size_bytes, storage_key)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		a.ID, a.EmailID, a.Filename, a.ContentType, a.SizeBytes, a.StorageKey)
	if err != nil {
		return fmt.Errorf("create attachment: %w", err)
	}
	return nil
}

func (r *AttachmentRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Attachment, error) {
	var a domain.Attachment
	err := r.db.QueryRow(ctx,
		`SELECT id, email_id, filename, content_type, size_bytes, storage_key, created_at
		 FROM attachments WHERE id = $1`, id).
		Scan(&a.ID, &a.EmailID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.StorageKey, &a.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (r *AttachmentRepo) ListByEmail(ctx context.Context, emailID uuid.UUID) ([]domain.Attachment, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, email_id, filename, content_type, size_bytes, storage_key, created_at
		 FROM attachments WHERE email_id = $1 ORDER BY filename`, emailID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var attachments []domain.Attachment
	for rows.Next() {
		var a domain.Attachment
		if err := rows.Scan(&a.ID, &a.EmailID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.StorageKey, &a.CreatedAt); err != nil {
			return nil, err
		}
		attachments = append(attachments, a)
	}
	return attachments, nil
}

func (r *AttachmentRepo) DeleteByEmail(ctx context.Context, emailID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT storage_key FROM attachments WHERE email_id = $1`, emailID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}

	_, err = r.db.Exec(ctx, `DELETE FROM attachments WHERE email_id = $1`, emailID)
	return keys, err
}
