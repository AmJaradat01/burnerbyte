package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	dnspkg "gitlab.com/amjaradat01/burnerbyte/internal/dns"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type DomainService struct {
	domainRepo *postgres.DomainRepo
	orgRepo    *postgres.OrgRepo
	cfg        *config.Config
}

func NewDomainService(domainRepo *postgres.DomainRepo, orgRepo *postgres.OrgRepo, cfg *config.Config) *DomainService {
	return &DomainService{domainRepo: domainRepo, orgRepo: orgRepo, cfg: cfg}
}

func (s *DomainService) AddDomain(ctx context.Context, orgID uuid.UUID, input domain.CreateDomainInput) (*domain.Domain, error) {
	if input.DomainName == "" {
		return nil, fmt.Errorf("domain_name is required")
	}

	// Check org quota
	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}

	maxDomains := s.cfg.Defaults.MaxDomains
	if org.Settings.MaxDomains != nil {
		maxDomains = *org.Settings.MaxDomains
	}

	count, err := s.domainRepo.CountByOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if count >= maxDomains {
		return nil, fmt.Errorf("domain limit reached (%d)", maxDomains)
	}

	d := &domain.Domain{
		ID:         uuid.New(),
		OrgID:      orgID,
		DomainName: input.DomainName,
	}

	if err := s.domainRepo.Create(ctx, d); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return nil, fmt.Errorf("domain already registered")
		}
		return nil, err
	}

	return d, nil
}

func (s *DomainService) GetDomain(ctx context.Context, orgID, id uuid.UUID) (*domain.Domain, error) {
	d, err := s.domainRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.OrgID != orgID {
		return nil, fmt.Errorf("domain not found")
	}
	d.VerificationRecord = dnspkg.GenerateVerificationRecord(d.ID.String())
	return d, nil
}

func (s *DomainService) ListByOrg(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.Domain, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	domains, total, err := s.domainRepo.ListByOrg(ctx, orgID, page, perPage)
	if err != nil {
		return nil, 0, err
	}
	for i := range domains {
		domains[i].VerificationRecord = dnspkg.GenerateVerificationRecord(domains[i].ID.String())
	}
	return domains, total, nil
}

func (s *DomainService) UpdateDomain(ctx context.Context, orgID, id uuid.UUID, input domain.UpdateDomainInput) (*domain.Domain, error) {
	d, err := s.domainRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.OrgID != orgID {
		return nil, fmt.Errorf("domain not found")
	}

	if input.Settings != nil {
		if input.Settings.AttachmentsEnabled != nil {
			v := *input.Settings.AttachmentsEnabled
			if v != "inherit" && v != "enabled" && v != "disabled" {
				return nil, fmt.Errorf("attachments_enabled must be inherit, enabled, or disabled")
			}
			d.Settings.AttachmentsEnabled = input.Settings.AttachmentsEnabled
		}
	}

	if err := s.domainRepo.Update(ctx, d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *DomainService) DeleteDomain(ctx context.Context, orgID, id uuid.UUID) error {
	d, err := s.domainRepo.GetByID(ctx, id)
	if err != nil { return err }
	if d.OrgID != orgID { return fmt.Errorf("domain not found") }
	return s.domainRepo.Delete(ctx, id)
}

func (s *DomainService) TriggerVerify(ctx context.Context, orgID, id uuid.UUID) (*domain.Domain, error) {
	d, err := s.domainRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.OrgID != orgID {
		return nil, fmt.Errorf("domain not found")
	}

	expectedTXT := dnspkg.GenerateVerificationRecord(d.ID.String())
	mx, _ := dnspkg.VerifyMX(d.DomainName, s.cfg.SMTP.Hostname)
	txt, _ := dnspkg.VerifyTXT(d.DomainName, expectedTXT)

	if err := s.domainRepo.UpdateDNSStatus(ctx, id, mx, txt); err != nil {
		return nil, err
	}

	d.MXVerified = mx
	d.TXTVerified = txt
	return d, nil
}
