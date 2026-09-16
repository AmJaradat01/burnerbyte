package domain

import (
	"time"

	"github.com/google/uuid"
)

type Webhook struct {
	ID            uuid.UUID  `json:"id"`
	TeamID        uuid.UUID  `json:"team_id"`
	CreatedBy     uuid.UUID  `json:"created_by"`
	URL           string     `json:"url"`
	Secret        string     `json:"secret,omitempty"`
	Events        []string   `json:"events"`
	Active        bool       `json:"active"`
	LastStatus    *int       `json:"last_status,omitempty"`
	LastAttemptAt *time.Time `json:"last_attempt_at,omitempty"`
	FailureCount  int        `json:"failure_count"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type CreateWebhookInput struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
}

type UpdateWebhookInput struct {
	URL    *string  `json:"url,omitempty"`
	Events []string `json:"events,omitempty"`
	Active *bool    `json:"active,omitempty"`
}

type WebhookDeliveryLog struct {
	ID             uuid.UUID `json:"id"`
	WebhookID      uuid.UUID `json:"webhook_id"`
	Event          string    `json:"event"`
	Payload        any       `json:"payload"`
	ResponseStatus *int      `json:"response_status,omitempty"`
	ResponseBody   *string   `json:"response_body,omitempty"`
	ResponseTimeMs *int      `json:"response_time_ms,omitempty"`
	Success        bool      `json:"success"`
	Attempt        int       `json:"attempt"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

type WebhookStats struct {
	TotalDeliveries   int64   `json:"total_deliveries"`
	SuccessCount      int64   `json:"success_count"`
	FailureCount      int64   `json:"failure_count"`
	SuccessRate       float64 `json:"success_rate"`
	AvgResponseTimeMs float64 `json:"avg_response_time_ms"`
	LastDeliveryAt    *string `json:"last_delivery_at,omitempty"`
}
