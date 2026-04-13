package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/burnerbyte/burnerbyte/internal/repository/redis"
	"gitlab.com/burnerbyte/burnerbyte/pkg/randaddr"
)

type InboxService struct {
	inboxRepo      *postgres.InboxRepo
	redisInboxRepo *redisrepo.InboxRepo
	assignmentRepo *postgres.DomainAssignmentRepo
	domainRepo     *postgres.DomainRepo
	orgRepo        *postgres.OrgRepo
	teamRepo       *postgres.TeamRepo
	counterRepo    *postgres.CounterRepo
	cfg            *config.Config
}

func NewInboxService(
	inboxRepo *postgres.InboxRepo,
	redisInboxRepo *redisrepo.InboxRepo,
	assignmentRepo *postgres.DomainAssignmentRepo,
	domainRepo *postgres.DomainRepo,
	orgRepo *postgres.OrgRepo,
	teamRepo *postgres.TeamRepo,
	counterRepo *postgres.CounterRepo,
	cfg *config.Config,
) *InboxService {
	return &InboxService{
		inboxRepo: inboxRepo, redisInboxRepo: redisInboxRepo,
		assignmentRepo: assignmentRepo, domainRepo: domainRepo,
		orgRepo: orgRepo, teamRepo: teamRepo, counterRepo: counterRepo, cfg: cfg,
	}
}

var aliasRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$`)

func (s *InboxService) CreateInbox(ctx context.Context, teamID, domainID, userID uuid.UUID, input domain.CreateInboxInput) (*domain.Inbox, error) {
	// Check assignment exists and access level
	assignment, err := s.assignmentRepo.GetByTeamAndDomain(ctx, teamID, domainID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, fmt.Errorf("domain not assigned to this team")
		}
		return nil, err
	}
	if assignment.AccessLevel == "read_only" {
		return nil, fmt.Errorf("read-only access — cannot create inboxes")
	}

	// Check quota
	dom, err := s.domainRepo.GetByID(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if !dom.MXVerified {
		return nil, fmt.Errorf("domain MX record not verified — mail cannot be received")
	}
	org, err := s.orgRepo.GetByID(ctx, dom.OrgID)
	if err != nil {
		return nil, err
	}
	maxInboxes := s.cfg.Defaults.MaxInboxesPerDomain
	if org.Settings.MaxInboxesPerDomain != nil {
		maxInboxes = *org.Settings.MaxInboxesPerDomain
	}
	count, err := s.inboxRepo.CountActiveByDomain(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if count >= maxInboxes {
		return nil, fmt.Errorf("inbox limit reached for this domain (%d)", maxInboxes)
	}

	// Generate or validate address
	var address string
	if input.CustomAlias != nil && *input.CustomAlias != "" {
		if !aliasRe.MatchString(*input.CustomAlias) {
			return nil, fmt.Errorf("invalid alias: must be 2-64 alphanumeric lowercase chars")
		}
		address = *input.CustomAlias
	} else {
		address, err = randaddr.Generate(8)
		if err != nil {
			return nil, err
		}
	}

	fullAddress := address + "@" + dom.DomainName

	// Resolve TTL via settings cascade
	resolver := NewSettingsResolver(s.assignmentRepo, s.domainRepo, s.orgRepo, s.cfg.Defaults)
	defaultTTL := resolver.ResolveDefaultInboxTTL(ctx, assignment.ID)
	maxTTL := resolver.ResolveMaxInboxTTL(ctx, assignment.ID)
	ttl := defaultTTL
	if input.TTL != nil {
		parsed, err := time.ParseDuration(*input.TTL)
		if err != nil {
			return nil, fmt.Errorf("invalid TTL format")
		}
		if parsed > maxTTL {
			return nil, fmt.Errorf("TTL exceeds maximum (%s)", maxTTL)
		}
		ttl = parsed
	}

	inbox := &domain.Inbox{
		ID:                 uuid.New(),
		DomainAssignmentID: assignment.ID,
		DomainID:           domainID,
		CreatedBy:          userID,
		Address:            address,
		FullAddress:        fullAddress,
		IsActive:           true,
		ExpiresAt:          time.Now().Add(ttl),
	}

	if err := s.inboxRepo.Create(ctx, inbox); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return nil, fmt.Errorf("address already taken")
		}
		return nil, err
	}

	// Increment all-time inbox counter on domain
	if err := s.domainRepo.IncrementInboxCount(ctx, domainID); err != nil {
		slog.Error("failed to increment domain inbox counter", "domain_id", domainID, "error", err)
	}

	// Increment org-level analytics counter
	if s.counterRepo != nil {
		if err := s.counterRepo.IncrementInbox(ctx, org.ID); err != nil {
			slog.Error("failed to increment org inbox counter", "org_id", org.ID, "error", err)
		}
		if err := s.counterRepo.UpsertDailyStat(ctx, org.ID, 0, 1, 0); err != nil {
			slog.Error("failed to upsert daily inbox stat", "org_id", org.ID, "error", err)
		}
		// Team-level analytics counters
		if err := s.counterRepo.IncrementTeamInbox(ctx, teamID); err != nil {
			slog.Error("failed to increment team inbox counter", "team_id", teamID, "error", err)
		}
		if err := s.counterRepo.UpsertDailyTeamStat(ctx, teamID, 0, 1, 0); err != nil {
			slog.Error("failed to upsert daily team inbox stat", "team_id", teamID, "error", err)
		}
	}

	// Store in Redis for SMTP lookups
	if err := s.redisInboxRepo.Set(ctx, fullAddress, inbox.ID.String(), ttl); err != nil {
		slog.Error("redis: failed to cache new inbox", "address", fullAddress, "error", err)
	}

	inbox.DomainName = dom.DomainName
	inbox.OrgID = org.ID
	inbox.TeamID = teamID
	return inbox, nil
}

func (s *InboxService) GetInbox(ctx context.Context, id, userID uuid.UUID) (*domain.Inbox, error) {
	inbox, err := s.inboxRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if inbox.CreatedBy != userID {
		return nil, fmt.Errorf("forbidden: not your inbox")
	}
	return inbox, nil
}

func (s *InboxService) ListByTeam(ctx context.Context, teamID, userID uuid.UUID, page, perPage int) ([]domain.Inbox, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.inboxRepo.ListByTeam(ctx, teamID, userID, page, perPage)
}

func (s *InboxService) ListByTeamWithStatus(ctx context.Context, teamID, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.inboxRepo.ListByTeamWithStatus(ctx, teamID, userID, status, page, perPage)
}

func (s *InboxService) ExtendTTL(ctx context.Context, id, userID uuid.UUID, extension string) (*domain.Inbox, error) {
	inbox, err := s.inboxRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if inbox.CreatedBy != userID {
		return nil, fmt.Errorf("forbidden: not your inbox")
	}

	resolver := NewSettingsResolver(s.assignmentRepo, s.domainRepo, s.orgRepo, s.cfg.Defaults)

	var ext time.Duration
	if extension == "" {
		ext = resolver.ResolveDefaultInboxTTL(ctx, inbox.DomainAssignmentID)
	} else {
		ext, err = time.ParseDuration(extension)
		if err != nil {
			return nil, fmt.Errorf("invalid extension format")
		}
	}

	newExpiry := time.Now().Add(ext)
	maxTTL := resolver.ResolveMaxInboxTTL(ctx, inbox.DomainAssignmentID)
	maxExpiry := inbox.CreatedAt.Add(maxTTL)
	if newExpiry.After(maxExpiry) {
		return nil, fmt.Errorf("extension would exceed max TTL (%s)", maxTTL)
	}

	if err := s.inboxRepo.ExtendTTL(ctx, id, newExpiry); err != nil {
		return nil, err
	}

	// Update Redis TTL
	remaining := time.Until(newExpiry)
	if err := s.redisInboxRepo.Set(ctx, inbox.FullAddress, inbox.ID.String(), remaining); err != nil {
		slog.Error("redis: failed to update inbox TTL", "address", inbox.FullAddress, "error", err)
	}

	inbox.ExpiresAt = newExpiry
	return inbox, nil
}

func (s *InboxService) DeleteInbox(ctx context.Context, id, userID uuid.UUID) error {
	inbox, err := s.inboxRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if inbox.CreatedBy != userID {
		return fmt.Errorf("forbidden: not your inbox")
	}

	if err := s.inboxRepo.Delete(ctx, id); err != nil {
		return err
	}

	if err := s.redisInboxRepo.Delete(ctx, inbox.FullAddress); err != nil {
		slog.Error("redis: failed to delete inbox cache", "address", inbox.FullAddress, "error", err)
	}
	return nil
}

func (s *InboxService) ListByUser(ctx context.Context, userID uuid.UUID, page, perPage int) ([]domain.Inbox, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.inboxRepo.ListByUser(ctx, userID, page, perPage)
}

func (s *InboxService) ListByUserWithStatus(ctx context.Context, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.inboxRepo.ListByUserWithStatus(ctx, userID, status, page, perPage)
}

func (s *InboxService) CreateInboxByAssignment(ctx context.Context, assignmentID, userID uuid.UUID, input domain.CreateInboxInput) (*domain.Inbox, error) {
	assignment, err := s.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return nil, fmt.Errorf("domain assignment not found")
	}
	if _, err := s.teamRepo.GetMembership(ctx, userID, assignment.TeamID); err != nil {
		return nil, fmt.Errorf("domain assignment not found")
	}
	return s.CreateInbox(ctx, assignment.TeamID, assignment.DomainID, userID, input)
}
