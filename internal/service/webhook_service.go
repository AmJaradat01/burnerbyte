package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/netguard"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
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
	if err := validateWebhookURL(input.URL); err != nil {
		return nil, err
	}
	for _, e := range input.Events {
		if !validEvents[e] {
			return nil, fmt.Errorf("invalid event: %s", e)
		}
	}

	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("generate webhook secret: %w", err)
	}
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
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	webhooks, total, err := s.webhookRepo.ListByTeam(ctx, teamID, page, perPage)
	if err != nil {
		return nil, 0, err
	}
	for i := range webhooks {
		webhooks[i].Secret = ""
	}
	return webhooks, total, nil
}

func (s *WebhookService) GetByID(ctx context.Context, teamID, id uuid.UUID) (*domain.Webhook, error) {
	w, err := s.webhookRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if w.TeamID != teamID {
		return nil, fmt.Errorf("webhook not found")
	}
	w.Secret = ""
	return w, nil
}

func (s *WebhookService) Update(ctx context.Context, teamID, id uuid.UUID, input domain.UpdateWebhookInput) (*domain.Webhook, error) {
	w, err := s.webhookRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if w.TeamID != teamID {
		return nil, fmt.Errorf("webhook not found")
	}
	if input.URL != nil {
		if err := validateWebhookURL(*input.URL); err != nil {
			return nil, err
		}
		w.URL = *input.URL
	}
	if input.Events != nil {
		w.Events = input.Events
	}
	if input.Active != nil {
		w.Active = *input.Active
	}
	if err := s.webhookRepo.Update(ctx, w); err != nil {
		return nil, err
	}
	w.Secret = ""
	return w, nil
}

func (s *WebhookService) Delete(ctx context.Context, teamID, id uuid.UUID) error {
	w, err := s.webhookRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if w.TeamID != teamID {
		return fmt.Errorf("webhook not found")
	}
	return s.webhookRepo.Delete(ctx, id)
}

func (s *WebhookService) ListDeliveryLogs(ctx context.Context, teamID, webhookID uuid.UUID, page, perPage int) ([]domain.WebhookDeliveryLog, int, error) {
	w, err := s.webhookRepo.GetByID(ctx, webhookID)
	if err != nil {
		return nil, 0, err
	}
	if w.TeamID != teamID {
		return nil, 0, fmt.Errorf("webhook not found")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.webhookRepo.ListDeliveryLogs(ctx, webhookID, page, perPage)
}

func (s *WebhookService) GetWebhookStats(ctx context.Context, webhookID uuid.UUID) (*domain.WebhookStats, error) {
	return s.webhookRepo.GetWebhookStats(ctx, webhookID)
}

// validateWebhookURL checks that a webhook URL is syntactically valid and
// does not point to private/internal IP ranges (SSRF prevention).
func validateWebhookURL(rawURL string) error {
	u, err := url.ParseRequestURI(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("webhook URL must use http or https")
	}
	// Over http the payload and its HMAC signature travel in clear text, so
	// anyone on the path reads every delivered event. Internal hosts are
	// rejected further down regardless, which leaves plain-http webhooks
	// pointing at public endpoints — always the wrong choice.
	//
	// Validation runs on create and update only, so webhooks already stored
	// keep delivering; an operator is asked to switch to https the next time
	// they edit one.
	if u.Scheme == "http" && !allowInsecureWebhookURLs {
		return fmt.Errorf("webhook URL must use https")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("webhook URL must have a hostname")
	}
	// Block obvious internal hostnames
	lower := strings.ToLower(host)
	if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower == "0.0.0.0" {
		return fmt.Errorf("webhook URL cannot target localhost")
	}
	if strings.HasSuffix(lower, ".internal") || strings.HasSuffix(lower, ".local") {
		return fmt.Errorf("webhook URL cannot target internal hostnames")
	}
	// Resolve and reject internal space. This is a friendly up-front error;
	// the dispatcher re-validates at dial time, which is what actually holds
	// against a record that changes between now and delivery.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := netguard.ResolveSafe(ctx, host); err != nil {
		var blocked *netguard.ErrBlocked
		if errors.As(err, &blocked) {
			return fmt.Errorf("webhook URL resolves to a private/internal IP address")
		}
		return fmt.Errorf("cannot resolve webhook hostname: %s", host)
	}
	return nil
}

// allowInsecureWebhookURLs relaxes the https requirement. It exists so tests
// and local development can point a webhook at a plain-HTTP listener; it is
// never set in a running server.
var allowInsecureWebhookURLs = false
