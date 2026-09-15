package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/database"
)

type Notification struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Type      string    `json:"type"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	IsRead    bool      `json:"is_read"`
	CreatedAt time.Time `json:"created_at"`
}

type NotificationRepo struct {
	db database.DBTX
}

func NewNotificationRepo(db database.DBTX) *NotificationRepo {
	return &NotificationRepo{db: db}
}

func (r *NotificationRepo) Create(ctx context.Context, userID uuid.UUID, typ, title, message string, inboxID *uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO notifications (user_id, type, title, message, inbox_id) VALUES ($1,$2,$3,$4,$5)`,
		userID, typ, title, message, inboxID)
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}
	return nil
}

func (r *NotificationRepo) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]Notification, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, type, title, message, is_read, created_at
		 FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.IsRead, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func (r *NotificationRepo) MarkRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

func (r *NotificationRepo) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`, userID)
	return err
}

func (r *NotificationRepo) DeleteAll(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM notifications WHERE user_id=$1`, userID)
	return err
}

func (r *NotificationRepo) Delete(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM notifications WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

func (r *NotificationRepo) CountUnread(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE`, userID).Scan(&count)
	return count, err
}
