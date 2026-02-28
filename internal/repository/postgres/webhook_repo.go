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

type WebhookRepo struct {
	db database.DBTX
}

func NewWebhookRepo(db database.DBTX) *WebhookRepo {
	return &WebhookRepo{db: db}
}

func (r *WebhookRepo) Create(ctx context.Context, w *domain.Webhook) error {
	events, _ := json.Marshal(w.Events)
	_, err := r.db.Exec(ctx,
		`INSERT INTO webhooks (id, team_id, created_by, url, secret, events, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		w.ID, w.TeamID, w.CreatedBy, w.URL, w.Secret, events, w.Active)
	if err != nil {
		return fmt.Errorf("create webhook: %w", err)
	}
	return nil
}

func (r *WebhookRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Webhook, error) {
	var w domain.Webhook
	var events []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, team_id, created_by, url, secret, events, active, last_status,
		        last_attempt_at, failure_count, created_at, updated_at
		 FROM webhooks WHERE id = $1`, id).
		Scan(&w.ID, &w.TeamID, &w.CreatedBy, &w.URL, &w.Secret, &events, &w.Active,
			&w.LastStatus, &w.LastAttemptAt, &w.FailureCount, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) { return nil, ErrNotFound }
		return nil, err
	}
	json.Unmarshal(events, &w.Events)
	return &w, nil
}

func (r *WebhookRepo) ListByTeam(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.Webhook, int, error) {
	var total int
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM webhooks WHERE team_id = $1`, teamID).Scan(&total)
	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, team_id, created_by, url, secret, events, active, last_status,
		        last_attempt_at, failure_count, created_at, updated_at
		 FROM webhooks WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, teamID, perPage, offset)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	var webhooks []domain.Webhook
	for rows.Next() {
		var w domain.Webhook
		var events []byte
		if err := rows.Scan(&w.ID, &w.TeamID, &w.CreatedBy, &w.URL, &w.Secret, &events, &w.Active,
			&w.LastStatus, &w.LastAttemptAt, &w.FailureCount, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(events, &w.Events)
		webhooks = append(webhooks, w)
	}
	return webhooks, total, nil
}

func (r *WebhookRepo) ListActiveByTeamAndEvent(ctx context.Context, teamID uuid.UUID, event string) ([]domain.Webhook, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, team_id, created_by, url, secret, events, active, last_status,
		        last_attempt_at, failure_count, created_at, updated_at
		 FROM webhooks WHERE team_id = $1 AND active = TRUE AND events @> $2::jsonb`,
		teamID, fmt.Sprintf(`["%s"]`, event))
	if err != nil { return nil, err }
	defer rows.Close()
	var webhooks []domain.Webhook
	for rows.Next() {
		var w domain.Webhook
		var events []byte
		if err := rows.Scan(&w.ID, &w.TeamID, &w.CreatedBy, &w.URL, &w.Secret, &events, &w.Active,
			&w.LastStatus, &w.LastAttemptAt, &w.FailureCount, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal(events, &w.Events)
		webhooks = append(webhooks, w)
	}
	return webhooks, nil
}

func (r *WebhookRepo) Update(ctx context.Context, w *domain.Webhook) error {
	events, _ := json.Marshal(w.Events)
	_, err := r.db.Exec(ctx,
		`UPDATE webhooks SET url=$1, events=$2, active=$3 WHERE id=$4`,
		w.URL, events, w.Active, w.ID)
	return err
}

func (r *WebhookRepo) UpdateDeliveryStatus(ctx context.Context, id uuid.UUID, status int, failureCount int) error {
	_, err := r.db.Exec(ctx,
		`UPDATE webhooks SET last_status=$1, last_attempt_at=NOW(), failure_count=$2 WHERE id=$3`,
		status, failureCount, id)
	return err
}

func (r *WebhookRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM webhooks WHERE id = $1`, id)
	return err
}

func (r *WebhookRepo) LogDelivery(ctx context.Context, log *domain.WebhookDeliveryLog) error {
	payload, _ := json.Marshal(log.Payload)
	_, err := r.db.Exec(ctx,
		`INSERT INTO webhook_delivery_logs (id, webhook_id, event, payload, response_status,
		 response_body, response_time_ms, success, attempt, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		log.ID, log.WebhookID, log.Event, payload, log.ResponseStatus,
		log.ResponseBody, log.ResponseTimeMs, log.Success, log.Attempt, log.IdempotencyKey)
	return err
}

func (r *WebhookRepo) ListFailedRetryable(ctx context.Context) ([]domain.Webhook, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, team_id, created_by, url, secret, events, active, last_status, last_attempt_at, failure_count, created_at, updated_at
		 FROM webhooks WHERE active = TRUE AND failure_count > 0 AND failure_count < 3`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var webhooks []domain.Webhook
	for rows.Next() {
		var w domain.Webhook
		var events []byte
		if err := rows.Scan(&w.ID, &w.TeamID, &w.CreatedBy, &w.URL, &w.Secret, &events,
			&w.Active, &w.LastStatus, &w.LastAttemptAt, &w.FailureCount, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal(events, &w.Events)
		webhooks = append(webhooks, w)
	}
	return webhooks, nil
}
