package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type DomainAssignmentService struct {
	assignmentRepo *postgres.DomainAssignmentRepo
	domainRepo     *postgres.DomainRepo
	orgRepo        *postgres.OrgRepo
	defaults       config.DefaultsConfig
}

func NewDomainAssignmentService(assignmentRepo *postgres.DomainAssignmentRepo, domainRepo *postgres.DomainRepo, orgRepo *postgres.OrgRepo, defaults config.DefaultsConfig) *DomainAssignmentService {
	return &DomainAssignmentService{assignmentRepo: assignmentRepo, domainRepo: domainRepo, orgRepo: orgRepo, defaults: defaults}
}

func (s *DomainAssignmentService) AssignDomain(ctx context.Context, teamID uuid.UUID, input domain.CreateAssignmentInput, assignedBy uuid.UUID) (*domain.DomainAssignment, error) {
	if input.AccessLevel != "full" && input.AccessLevel != "create_inbox" && input.AccessLevel != "read_only" {
		return nil, fmt.Errorf("invalid access_level: %s", input.AccessLevel)
	}

	domainID, err := uuid.Parse(input.DomainID)
	if err != nil {
		return nil, fmt.Errorf("invalid domain_id")
	}

	// Verify domain exists and is verified
	d, err := s.domainRepo.GetByID(ctx, domainID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, fmt.Errorf("domain not found")
		}
		return nil, err
	}
	if !d.MXVerified || !d.TXTVerified {
		return nil, fmt.Errorf("domain must have both MX and TXT records verified before assignment")
	}

	a := &domain.DomainAssignment{
		ID:          uuid.New(),
		TeamID:      teamID,
		DomainID:    domainID,
		AccessLevel: input.AccessLevel,
		AssignedBy:  &assignedBy,
	}

	if err := s.assignmentRepo.Create(ctx, a); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return nil, fmt.Errorf("domain already assigned to this team")
		}
		return nil, err
	}

	return a, nil
}

func (s *DomainAssignmentService) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.DomainAssignment, error) {
	assignments, err := s.assignmentRepo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	resolver := NewSettingsResolver(s.assignmentRepo, s.domainRepo, s.orgRepo, s.defaults)
	for i := range assignments {
		assignments[i].DefaultTTL = resolver.ResolveDefaultInboxTTL(ctx, assignments[i].ID).String()
		assignments[i].MaxTTL = resolver.ResolveMaxInboxTTL(ctx, assignments[i].ID).String()
	}
	return assignments, nil
}

func (s *DomainAssignmentService) ListByTeam(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.DomainAssignment, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.assignmentRepo.ListByTeam(ctx, teamID, page, perPage)
}

func (s *DomainAssignmentService) UpdateAssignment(ctx context.Context, teamID, domainID uuid.UUID, input domain.UpdateAssignmentInput) (*domain.DomainAssignment, error) {
	a, err := s.assignmentRepo.GetByTeamAndDomain(ctx, teamID, domainID)
	if err != nil {
		return nil, err
	}

	if input.AccessLevel != nil {
		v := *input.AccessLevel
		if v != "full" && v != "create_inbox" && v != "read_only" {
			return nil, fmt.Errorf("invalid access_level: %s", v)
		}
		a.AccessLevel = v
	}

	if input.Settings != nil {
		if input.Settings.AttachmentsEnabled != nil {
			a.Settings.AttachmentsEnabled = input.Settings.AttachmentsEnabled
		}
		if input.Settings.MaxInboxTTL != nil {
			a.Settings.MaxInboxTTL = input.Settings.MaxInboxTTL
		}
	}

	if err := s.assignmentRepo.Update(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

func (s *DomainAssignmentService) Unassign(ctx context.Context, teamID, domainID uuid.UUID) error {
	a, err := s.assignmentRepo.GetByTeamAndDomain(ctx, teamID, domainID)
	if err != nil {
		return err
	}
	return s.assignmentRepo.Delete(ctx, a.ID)
}
