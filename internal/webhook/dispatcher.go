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

	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/netguard"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type Dispatcher struct {
	webhookRepo *postgres.WebhookRepo
	client      *http.Client
	timeout     time.Duration
	maxRetries  int
}

func NewDispatcher(webhookRepo *postgres.WebhookRepo, timeout time.Duration, maxRetries int) *Dispatcher {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if maxRetries <= 0 {
		maxRetries = 3
	}
	// Resolves, rejects internal space and then dials the validated literal,
	// so a rebound DNS record cannot redirect the connection — including on
	// a redirect, which re-enters this same dialer.
	transport := &http.Transport{DialContext: netguard.DialContext(10 * time.Second)}
	return &Dispatcher{
		webhookRepo: webhookRepo,
		client:      &http.Client{Timeout: timeout, Transport: transport},
		timeout:     timeout,
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
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("webhook: failed to marshal payload", "event", event, "error", err)
		return
	}

	for _, wh := range webhooks {
		go d.deliver(wh, event, body)
	}
}

func (d *Dispatcher) deliver(wh domain.Webhook, event string, body []byte) {
	// Use background context — webhook delivery is fire-and-forget,
	// must not be cancelled when the parent HTTP/SMTP request completes
	ctx, cancel := context.WithTimeout(context.Background(), d.timeout*time.Duration(d.maxRetries+1))
	defer cancel()

	idempotencyKey := fmt.Sprintf("%s:%s", uuid.New(), wh.ID)
	backoffs := []time.Duration{0, 1 * time.Second, 5 * time.Second, 25 * time.Second}

	for attempt := 1; attempt <= d.maxRetries; attempt++ {
		if attempt > 1 {
			idx := attempt
			if idx >= len(backoffs) {
				idx = len(backoffs) - 1
			}
			select {
			case <-time.After(backoffs[idx]):
			case <-ctx.Done():
				return
			}
		}

		start := time.Now()
		req, err := http.NewRequestWithContext(ctx, "POST", wh.URL, bytes.NewReader(body))
		if err != nil {
			slog.Error("webhook: failed to create request", "url", wh.URL, "error", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-BurnerByte-Signature", sign(body, wh.Secret))
		req.Header.Set("X-BurnerByte-Event", event)
		req.Header.Set("X-BurnerByte-Delivery-ID", idempotencyKey)

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
			if err := d.webhookRepo.LogDelivery(ctx, log); err != nil {
				slog.Error("webhook: failed to log delivery", "webhook_id", wh.ID, "error", err)
			}
			continue
		}

		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		respBodyStr := string(respBody)

		log.ResponseStatus = &resp.StatusCode
		log.ResponseBody = &respBodyStr
		log.Success = resp.StatusCode >= 200 && resp.StatusCode < 300

		if err := d.webhookRepo.LogDelivery(ctx, log); err != nil {
			slog.Error("webhook: failed to log delivery", "webhook_id", wh.ID, "error", err)
		}

		if log.Success {
			if err := d.webhookRepo.UpdateDeliveryStatus(ctx, wh.ID, resp.StatusCode, 0); err != nil {
				slog.Error("webhook: failed to update delivery status", "webhook_id", wh.ID, "error", err)
			}
			return
		}
	}

	// All retries failed
	if err := d.webhookRepo.UpdateDeliveryStatus(ctx, wh.ID, 0, wh.FailureCount+1); err != nil {
		slog.Error("webhook: failed to update delivery status", "webhook_id", wh.ID, "error", err)
	}
	slog.Warn("webhook delivery failed after retries", "webhook_id", wh.ID, "event", event)
}

func sign(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
