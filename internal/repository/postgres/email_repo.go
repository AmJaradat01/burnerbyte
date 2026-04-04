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

type EmailRepo struct {
	db database.DBTX
}

func NewEmailRepo(db database.DBTX) *EmailRepo {
	return &EmailRepo{db: db}
}

func (r *EmailRepo) Create(ctx context.Context, e *domain.Email) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO emails (id, inbox_id, message_id, from_address, to_address, subject,
		 body_text, body_html, has_attachments, raw_headers, size_bytes, spam_score, is_read, received_at, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		e.ID, e.InboxID, e.MessageID, e.FromAddress, e.ToAddress, e.Subject,
		e.BodyText, e.BodyHTML, e.HasAttachments, e.RawHeaders, e.SizeBytes,
		e.SpamScore, e.IsRead, e.ReceivedAt, e.ExpiresAt)
	if err != nil {
		return fmt.Errorf("create email: %w", err)
	}
	return nil
}

func (r *EmailRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Email, error) {
	var e domain.Email
	err := r.db.QueryRow(ctx,
		`SELECT id, inbox_id, message_id, from_address, to_address, subject,
		        body_text, body_html, has_attachments, raw_headers, size_bytes,
		        spam_score, is_read, received_at, expires_at
		 FROM emails WHERE id = $1`, id).
		Scan(&e.ID, &e.InboxID, &e.MessageID, &e.FromAddress, &e.ToAddress, &e.Subject,
			&e.BodyText, &e.BodyHTML, &e.HasAttachments, &e.RawHeaders, &e.SizeBytes,
			&e.SpamScore, &e.IsRead, &e.ReceivedAt, &e.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &e, nil
}

func (r *EmailRepo) ListByInbox(ctx context.Context, inboxID uuid.UUID, page, perPage int) ([]domain.EmailSummary, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM emails WHERE inbox_id = $1`, inboxID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, from_address, subject, COALESCE(LEFT(body_text, 120), ''), has_attachments, is_read, size_bytes, received_at
		 FROM emails WHERE inbox_id = $1 ORDER BY received_at DESC LIMIT $2 OFFSET $3`,
		inboxID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var emails []domain.EmailSummary
	for rows.Next() {
		var e domain.EmailSummary
		if err := rows.Scan(&e.ID, &e.FromAddress, &e.Subject, &e.Snippet, &e.HasAttachments,
			&e.IsRead, &e.SizeBytes, &e.ReceivedAt); err != nil {
			return nil, 0, err
		}
		emails = append(emails, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return emails, total, nil
}

func (r *EmailRepo) Search(ctx context.Context, inboxID uuid.UUID, query string, page, perPage int) ([]domain.EmailSummary, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails WHERE inbox_id = $1 AND search_vector @@ plainto_tsquery('english', $2)`,
		inboxID, query).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, from_address, subject, COALESCE(LEFT(body_text, 120), ''), has_attachments, is_read, size_bytes, received_at
		 FROM emails WHERE inbox_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
		 ORDER BY received_at DESC LIMIT $3 OFFSET $4`,
		inboxID, query, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var emails []domain.EmailSummary
	for rows.Next() {
		var e domain.EmailSummary
		if err := rows.Scan(&e.ID, &e.FromAddress, &e.Subject, &e.Snippet, &e.HasAttachments,
			&e.IsRead, &e.SizeBytes, &e.ReceivedAt); err != nil {
			return nil, 0, err
		}
		emails = append(emails, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return emails, total, nil
}

func (r *EmailRepo) MarkRead(ctx context.Context, id uuid.UUID, isRead bool) error {
	_, err := r.db.Exec(ctx, `UPDATE emails SET is_read = $1 WHERE id = $2`, isRead, id)
	return err
}

func (r *EmailRepo) MarkAllRead(ctx context.Context, inboxID uuid.UUID) (int64, error) {
	tag, err := r.db.Exec(ctx, `UPDATE emails SET is_read = true WHERE inbox_id = $1 AND is_read = false`, inboxID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *EmailRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM emails WHERE id = $1`, id)
	return err
}

func (r *EmailRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM emails WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *EmailRepo) DeleteExpiredReturningIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `DELETE FROM emails WHERE expires_at < NOW() RETURNING id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}
