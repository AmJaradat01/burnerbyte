package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/amjaradat01/burnerbyte/internal/repository/redis"
	"gitlab.com/amjaradat01/burnerbyte/pkg/randaddr"
)

type InboxService struct {
	inboxRepo      *postgres.InboxRepo
	redisInboxRepo *redisrepo.InboxRepo
	assignmentRepo *postgres.DomainAssignmentRepo
	domainRepo     *postgres.DomainRepo
	orgRepo        *postgres.OrgRepo
	cfg            *config.Config
}

func NewInboxService(
	inboxRepo *postgres.InboxRepo,
	redisInboxRepo *redisrepo.InboxRepo,
	assignmentRepo *postgres.DomainAssignmentRepo,
	domainRepo *postgres.DomainRepo,
	orgRepo *postgres.OrgRepo,
	cfg *config.Config,
) *InboxService {
	return &InboxService{
		inboxRepo: inboxRepo, redisInboxRepo: redisInboxRepo,
		assignmentRepo: assignmentRepo, domainRepo: domainRepo,
		orgRepo: orgRepo, cfg: cfg,
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

	// Resolve TTL
	ttl := s.cfg.Defaults.DefaultInboxTTL
	if input.TTL != nil {
		parsed, err := time.ParseDuration(*input.TTL)
		if err != nil {
			return nil, fmt.Errorf("invalid TTL format")
		}
		if parsed > s.cfg.Defaults.MaxInboxTTL {
			return nil, fmt.Errorf("TTL exceeds maximum (%s)", s.cfg.Defaults.MaxInboxTTL)
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

	// Store in Redis for SMTP lookups
	_ = s.redisInboxRepo.Set(ctx, fullAddress, inbox.ID.String(), ttl)

	inbox.DomainName = dom.DomainName
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

func (s *InboxService) ExtendTTL(ctx context.Context, id, userID uuid.UUID, extension string) (*domain.Inbox, error) {
	inbox, err := s.inboxRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if inbox.CreatedBy != userID {
		return nil, fmt.Errorf("forbidden: not your inbox")
	}

	ext, err := time.ParseDuration(extension)
	if err != nil {
		return nil, fmt.Errorf("invalid extension format")
	}

	newExpiry := inbox.ExpiresAt.Add(ext)
	maxExpiry := inbox.CreatedAt.Add(s.cfg.Defaults.MaxInboxTTL)
	if newExpiry.After(maxExpiry) {
		return nil, fmt.Errorf("extension would exceed max TTL")
	}

	if err := s.inboxRepo.ExtendTTL(ctx, id, newExpiry); err != nil {
		return nil, err
	}

	// Update Redis TTL
	remaining := time.Until(newExpiry)
	_ = s.redisInboxRepo.Set(ctx, inbox.FullAddress, inbox.ID.String(), remaining)

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

	_ = s.redisInboxRepo.Delete(ctx, inbox.FullAddress)
	return nil
}
