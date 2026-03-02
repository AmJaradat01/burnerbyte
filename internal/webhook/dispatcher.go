package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type Dispatcher struct {
	webhookRepo *postgres.WebhookRepo
	client      *http.Client
	maxRetries  int
}

func NewDispatcher(webhookRepo *postgres.WebhookRepo, timeout time.Duration, maxRetries int) *Dispatcher {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if maxRetries <= 0 {
		maxRetries = 3
	}
	return &Dispatcher{
		webhookRepo: webhookRepo,
		client:      &http.Client{Timeout: timeout},
		maxRetries:  maxRetries,
	}
}

type EventPayload struct {
	Event     string    `json:"event"`
	Timestamp time.Time `json:"timestamp"`
	Data      any       `json:"data"`
}

// Dispatch sends an event to all active webhooks for the team.
func (d *Dispatcher) Dispatch(ctx context.Context, teamID uuid.UUID, event string, data any) {
	webhooks, err := d.webhookRepo.ListActiveByTeamAndEvent(ctx, teamID, event)
	if err != nil {
		slog.Error("webhook dispatch: list failed", "error", err)
		return
	}

	payload := EventPayload{Event: event, Timestamp: time.Now(), Data: data}
	body, _ := json.Marshal(payload)

	for _, wh := range webhooks {
		go d.deliver(ctx, wh, event, body)
	}
}

func (d *Dispatcher) deliver(ctx context.Context, wh domain.Webhook, event string, body []byte) {
	idempotencyKey := fmt.Sprintf("%s:%s", uuid.New(), wh.ID)
	backoffs := []time.Duration{0, 1 * time.Second, 5 * time.Second, 25 * time.Second}

	for attempt := 1; attempt <= d.maxRetries; attempt++ {
		if attempt > 1 {
			time.Sleep(backoffs[attempt])
		}

		start := time.Now()
		req, _ := http.NewRequestWithContext(ctx, "POST", wh.URL, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-BurnerByte-Signature", sign(body, wh.Secret))
		req.Header.Set("X-BurnerByte-Event", event)

		resp, err := d.client.Do(req)
		elapsed := int(time.Since(start).Milliseconds())

		log := &domain.WebhookDeliveryLog{
			ID:             uuid.New(),
			WebhookID:      wh.ID,
			Event:          event,
			Payload:        json.RawMessage(body),
			ResponseTimeMs: &elapsed,
			Attempt:        attempt,
			IdempotencyKey: idempotencyKey,
		}

		if err != nil {
			log.Success = false
			d.webhookRepo.LogDelivery(ctx, log)
			continue
		}

		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		respBodyStr := string(respBody)

		log.ResponseStatus = &resp.StatusCode
		log.ResponseBody = &respBodyStr
		log.Success = resp.StatusCode >= 200 && resp.StatusCode < 300

		d.webhookRepo.LogDelivery(ctx, log)

		if log.Success {
			d.webhookRepo.UpdateDeliveryStatus(ctx, wh.ID, resp.StatusCode, 0)
			return
		}
	}

	// All retries failed
	d.webhookRepo.UpdateDeliveryStatus(ctx, wh.ID, 0, wh.FailureCount+1)
	slog.Warn("webhook delivery failed after retries", "webhook_id", wh.ID, "event", event)
}

func sign(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
