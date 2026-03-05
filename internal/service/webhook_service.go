package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type WebhookService struct {
	webhookRepo *postgres.WebhookRepo
}

func NewWebhookService(webhookRepo *postgres.WebhookRepo) *WebhookService {
	return &WebhookService{webhookRepo: webhookRepo}
}

var validEvents = map[string]bool{
	"email.received": true, "inbox.created": true, "inbox.expired": true,
}

func (s *WebhookService) Create(ctx context.Context, teamID, userID uuid.UUID, input domain.CreateWebhookInput) (*domain.Webhook, error) {
	if _, err := url.ParseRequestURI(input.URL); err != nil {
		return nil, fmt.Errorf("invalid URL")
	}
	for _, e := range input.Events {
		if !validEvents[e] {
			return nil, fmt.Errorf("invalid event: %s", e)
		}
	}

	b := make([]byte, 32)
	rand.Read(b)
	secret := hex.EncodeToString(b)

	w := &domain.Webhook{
		ID: uuid.New(), TeamID: teamID, CreatedBy: userID,
		URL: input.URL, Secret: secret, Events: input.Events, Active: true,
	}
	if err := s.webhookRepo.Create(ctx, w); err != nil {
		return nil, err
	}
	return w, nil
}

func (s *WebhookService) List(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.Webhook, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	webhooks, total, err := s.webhookRepo.ListByTeam(ctx, teamID, page, perPage)
	if err != nil { return nil, 0, err }
	for i := range webhooks { webhooks[i].Secret = "" }
	return webhooks, total, nil
}

func (s *WebhookService) Update(ctx context.Context, teamID, id uuid.UUID, input domain.UpdateWebhookInput) (*domain.Webhook, error) {
	w, err := s.webhookRepo.GetByID(ctx, id)
	if err != nil { return nil, err }
	if w.TeamID != teamID { return nil, fmt.Errorf("webhook not found") }
	if input.URL != nil { w.URL = *input.URL }
	if input.Events != nil { w.Events = input.Events }
	if input.Active != nil { w.Active = *input.Active }
	if err := s.webhookRepo.Update(ctx, w); err != nil { return nil, err }
	w.Secret = ""
	return w, nil
}

func (s *WebhookService) Delete(ctx context.Context, teamID, id uuid.UUID) error {
	w, err := s.webhookRepo.GetByID(ctx, id)
	if err != nil { return err }
	if w.TeamID != teamID { return fmt.Errorf("webhook not found") }
	return s.webhookRepo.Delete(ctx, id)
}

func (s *WebhookService) ListDeliveryLogs(ctx context.Context, teamID, webhookID uuid.UUID, page, perPage int) ([]domain.WebhookDeliveryLog, int, error) {
	w, err := s.webhookRepo.GetByID(ctx, webhookID)
	if err != nil { return nil, 0, err }
	if w.TeamID != teamID { return nil, 0, fmt.Errorf("webhook not found") }
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.webhookRepo.ListDeliveryLogs(ctx, webhookID, page, perPage)
}
