package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	dnspkg "gitlab.com/burnerbyte/burnerbyte/internal/dns"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

var domainNameRe = regexp.MustCompile(`^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`)

type DomainService struct {
	domainRepo     *postgres.DomainRepo
	orgRepo        *postgres.OrgRepo
	inboxRepo      *postgres.InboxRepo
	redisInboxRepo RedisInboxDeleter
	verHistoryRepo *postgres.VerificationHistoryRepo
	cfg            *config.Config
}

// RedisInboxDeleter is the minimal interface for cleaning up Redis inbox keys.
type RedisInboxDeleter interface {
	Delete(ctx context.Context, fullAddress string) error
}

func NewDomainService(
	domainRepo *postgres.DomainRepo,
	orgRepo *postgres.OrgRepo,
	inboxRepo *postgres.InboxRepo,
	redisInboxRepo RedisInboxDeleter,
	verHistoryRepo *postgres.VerificationHistoryRepo,
	cfg *config.Config,
) *DomainService {
	return &DomainService{
		domainRepo:     domainRepo,
		orgRepo:        orgRepo,
		inboxRepo:      inboxRepo,
		redisInboxRepo: redisInboxRepo,
		verHistoryRepo: verHistoryRepo,
		cfg:            cfg,
	}
}

// ComputeStatus returns the computed status string for a domain based on its verification state.
// SPF is informational only and does not affect the status.
func ComputeStatus(d *domain.Domain) string {
	if d.MXVerified && d.TXTVerified {
		return "verified"
	}
	if !d.MXVerified && !d.TXTVerified {
		if d.DNSLastCheckedAt == nil {
			return "pending_verification"
		}
		return "failed"
	}
	return "partially_verified"
}

func (s *DomainService) AddDomain(ctx context.Context, orgID uuid.UUID, input domain.CreateDomainInput) (*domain.Domain, error) {
	if input.DomainName == "" {
		return nil, fmt.Errorf("domain_name is required")
	}
	name := strings.ToLower(strings.TrimSpace(input.DomainName))
	if !domainNameRe.MatchString(name) {
		return nil, fmt.Errorf("invalid domain name format")
	}
	// Block localhost and private hostnames
	if name == "localhost" || strings.HasSuffix(name, ".local") || strings.HasSuffix(name, ".internal") {
		return nil, fmt.Errorf("cannot add private/internal domain")
	}
	input.DomainName = name

	// Validate description length
	if len(input.Description) > 1000 {
		return nil, fmt.Errorf("description must not exceed 1000 characters")
	}

	// Check org quota
	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}

	maxDomains := s.cfg.RuntimeDefaults().MaxDomains
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
		ID:          uuid.New(),
		OrgID:       orgID,
		DomainName:  input.DomainName,
		Description: input.Description,
	}

	if err := s.domainRepo.Create(ctx, d); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return nil, fmt.Errorf("domain already registered")
		}
		return nil, err
	}

	d.Status = ComputeStatus(d)

	// Async auto-verify
	go s.autoVerify(d.ID, d.DomainName)

	return d, nil
}

func (s *DomainService) autoVerify(domainID uuid.UUID, domainName string) {
	ctx := context.Background()
	expectedTXT := dnspkg.GenerateVerificationRecord(domainID.String())
	mx, mxErr := dnspkg.VerifyMX(domainName, s.cfg.SMTP.Hostname)
	txt, txtErr := dnspkg.VerifyTXT(domainName, expectedTXT)
	spf, spfErr := dnspkg.VerifySPF(domainName, s.cfg.SMTP.Hostname)

	if err := s.domainRepo.UpdateDNSStatus(ctx, domainID, mx, txt, spf); err != nil {
		slog.Error("auto-verify: failed to update DNS status", "domain_id", domainID, "error", err)
	}

	// Record verification history
	if s.verHistoryRepo != nil {
		var errDetails *string
		var errParts []string
		if mxErr != nil {
			errParts = append(errParts, "mx: "+mxErr.Error())
		}
		if txtErr != nil {
			errParts = append(errParts, "txt: "+txtErr.Error())
		}
		if spfErr != nil {
			errParts = append(errParts, "spf: "+spfErr.Error())
		}
		if len(errParts) > 0 {
			combined := strings.Join(errParts, "; ")
			errDetails = &combined
		}
		record := &domain.VerificationHistory{
			ID:            uuid.New(),
			DomainID:      domainID,
			CheckedAt:     time.Now(),
			MXResult:      mx,
			TXTResult:     txt,
			SPFResult:     spf,
			TriggerSource: "auto_create",
			ErrorDetails:  errDetails,
		}
		if err := s.verHistoryRepo.Create(ctx, record); err != nil {
			slog.Error("auto-verify: failed to record history", "domain_id", domainID, "error", err)
		}
	}
}

func (s *DomainService) GetDomain(ctx context.Context, orgID, id uuid.UUID) (*domain.Domain, error) {
	d, err := s.domainRepo.GetByIDEnriched(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.OrgID != orgID {
		return nil, fmt.Errorf("domain not found")
	}
	d.VerificationRecord = dnspkg.GenerateVerificationRecord(d.ID.String())
	d.Status = ComputeStatus(d)
	return d, nil
}

func (s *DomainService) ListByOrg(ctx context.Context, orgID uuid.UUID, filter domain.DomainListFilter, page, perPage int) ([]domain.Domain, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	domains, total, err := s.domainRepo.ListByOrgFiltered(ctx, orgID, filter, page, perPage)
	if err != nil {
		return nil, 0, err
	}
	for i := range domains {
		domains[i].VerificationRecord = dnspkg.GenerateVerificationRecord(domains[i].ID.String())
		domains[i].Status = ComputeStatus(&domains[i])
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

	// Update description
	if input.Description != nil {
		if len(*input.Description) > 1000 {
			return nil, fmt.Errorf("description must not exceed 1000 characters")
		}
		d.Description = *input.Description
	}

	if input.Settings != nil {
		if input.Settings.AttachmentsEnabled != nil {
			v := *input.Settings.AttachmentsEnabled
			if v != "inherit" && v != "enabled" && v != "disabled" {
				return nil, fmt.Errorf("attachments_enabled must be inherit, enabled, or disabled")
			}
			d.Settings.AttachmentsEnabled = input.Settings.AttachmentsEnabled
		}

		if input.Settings.DefaultInboxTTL != nil {
			if _, err := time.ParseDuration(*input.Settings.DefaultInboxTTL); err != nil {
				return nil, fmt.Errorf("invalid default_inbox_ttl duration")
			}
			d.Settings.DefaultInboxTTL = input.Settings.DefaultInboxTTL
		}

		if input.Settings.MaxInboxTTL != nil {
			if _, err := time.ParseDuration(*input.Settings.MaxInboxTTL); err != nil {
				return nil, fmt.Errorf("invalid max_inbox_ttl duration")
			}
			d.Settings.MaxInboxTTL = input.Settings.MaxInboxTTL
		}

		if input.Settings.MaxInboxesPerDomain != nil {
			if *input.Settings.MaxInboxesPerDomain <= 0 {
				return nil, fmt.Errorf("max_inboxes_per_domain must be a positive integer")
			}
			d.Settings.MaxInboxesPerDomain = input.Settings.MaxInboxesPerDomain
		}

		// Validate default TTL does not exceed max TTL
		if d.Settings.DefaultInboxTTL != nil && d.Settings.MaxInboxTTL != nil {
			defaultTTL, _ := time.ParseDuration(*d.Settings.DefaultInboxTTL)
			maxTTL, _ := time.ParseDuration(*d.Settings.MaxInboxTTL)
			if defaultTTL > maxTTL {
				return nil, fmt.Errorf("default_inbox_ttl exceeds max_inbox_ttl")
			}
		}
	}

	if err := s.domainRepo.Update(ctx, d); err != nil {
		return nil, err
	}
	d.Status = ComputeStatus(d)
	return d, nil
}

func (s *DomainService) DeleteDomain(ctx context.Context, orgID, id uuid.UUID) error {
	d, err := s.domainRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if d.OrgID != orgID {
		return fmt.Errorf("domain not found")
	}

	// Clean up Redis inbox keys for this domain's active inboxes
	if s.redisInboxRepo != nil && s.inboxRepo != nil {
		addresses, err := s.inboxRepo.ListActiveAddressesByDomain(ctx, id)
		if err == nil {
			for _, addr := range addresses {
				_ = s.redisInboxRepo.Delete(ctx, addr)
			}
		}
	}

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
	mx, mxErr := dnspkg.VerifyMX(d.DomainName, s.cfg.SMTP.Hostname)
	txt, txtErr := dnspkg.VerifyTXT(d.DomainName, expectedTXT)
	spf, spfErr := dnspkg.VerifySPF(d.DomainName, s.cfg.SMTP.Hostname)
	// A failed lookup (transient DNS/network error) must not downgrade a
	// previously-verified record; preserve the last known status on error.
	mx = dnspkg.ResolveStatus(d.MXVerified, mx, mxErr)
	txt = dnspkg.ResolveStatus(d.TXTVerified, txt, txtErr)
	spf = dnspkg.ResolveStatus(d.SPFVerified, spf, spfErr)

	if err := s.domainRepo.UpdateDNSStatus(ctx, id, mx, txt, spf); err != nil {
		return nil, err
	}

	d.MXVerified = mx
	d.TXTVerified = txt
	d.SPFVerified = spf
	now := time.Now()
	d.DNSLastCheckedAt = &now
	d.Status = ComputeStatus(d)

	// Record verification history
	if s.verHistoryRepo != nil {
		var errDetails *string
		var errParts []string
		if mxErr != nil {
			errParts = append(errParts, "mx: "+mxErr.Error())
		}
		if txtErr != nil {
			errParts = append(errParts, "txt: "+txtErr.Error())
		}
		if spfErr != nil {
			errParts = append(errParts, "spf: "+spfErr.Error())
		}
		if len(errParts) > 0 {
			combined := strings.Join(errParts, "; ")
			errDetails = &combined
		}
		record := &domain.VerificationHistory{
			ID:            uuid.New(),
			DomainID:      id,
			CheckedAt:     now,
			MXResult:      mx,
			TXTResult:     txt,
			SPFResult:     spf,
			TriggerSource: "manual",
			ErrorDetails:  errDetails,
		}
		if err := s.verHistoryRepo.Create(ctx, record); err != nil {
			slog.Error("trigger-verify: failed to record history", "domain_id", id, "error", err)
		}
	}

	return d, nil
}

func (s *DomainService) BulkVerify(ctx context.Context, orgID uuid.UUID, domainIDs []uuid.UUID) (*domain.BulkVerifyResult, error) {
	if len(domainIDs) > 50 {
		return nil, fmt.Errorf("bulk operation limited to 50 domain IDs")
	}

	result := &domain.BulkVerifyResult{}

	for _, did := range domainIDs {
		d, err := s.domainRepo.GetByID(ctx, did)
		if err != nil {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "domain not found"})
			continue
		}
		if d.OrgID != orgID {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "domain not found"})
			continue
		}

		expectedTXT := dnspkg.GenerateVerificationRecord(d.ID.String())
		mx, mxErr := dnspkg.VerifyMX(d.DomainName, s.cfg.SMTP.Hostname)
		txt, txtErr := dnspkg.VerifyTXT(d.DomainName, expectedTXT)
		spf, spfErr := dnspkg.VerifySPF(d.DomainName, s.cfg.SMTP.Hostname)
		// Preserve last-known status on a lookup error (transient failures must
		// not downgrade a verified domain).
		mx = dnspkg.ResolveStatus(d.MXVerified, mx, mxErr)
		txt = dnspkg.ResolveStatus(d.TXTVerified, txt, txtErr)
		spf = dnspkg.ResolveStatus(d.SPFVerified, spf, spfErr)

		if err := s.domainRepo.UpdateDNSStatus(ctx, did, mx, txt, spf); err != nil {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "failed to update DNS status"})
			continue
		}

		d.MXVerified = mx
		d.TXTVerified = txt
		d.SPFVerified = spf
		now := time.Now()
		d.DNSLastCheckedAt = &now
		status := ComputeStatus(d)

		// Record verification history
		if s.verHistoryRepo != nil {
			var errDetails *string
			var errParts []string
			if mxErr != nil {
				errParts = append(errParts, "mx: "+mxErr.Error())
			}
			if txtErr != nil {
				errParts = append(errParts, "txt: "+txtErr.Error())
			}
			if spfErr != nil {
				errParts = append(errParts, "spf: "+spfErr.Error())
			}
			if len(errParts) > 0 {
				combined := strings.Join(errParts, "; ")
				errDetails = &combined
			}
			record := &domain.VerificationHistory{
				ID:            uuid.New(),
				DomainID:      did,
				CheckedAt:     now,
				MXResult:      mx,
				TXTResult:     txt,
				SPFResult:     spf,
				TriggerSource: "manual",
				ErrorDetails:  errDetails,
			}
			_ = s.verHistoryRepo.Create(ctx, record)
		}

		result.Results = append(result.Results, domain.BulkVerifyItem{
			DomainID:    did,
			DomainName:  d.DomainName,
			MXVerified:  mx,
			TXTVerified: txt,
			SPFVerified: spf,
			Status:      status,
		})
	}

	return result, nil
}

func (s *DomainService) BulkDelete(ctx context.Context, orgID uuid.UUID, domainIDs []uuid.UUID, force bool) (*domain.BulkDeleteResult, error) {
	if len(domainIDs) > 50 {
		return nil, fmt.Errorf("bulk operation limited to 50 domain IDs")
	}

	result := &domain.BulkDeleteResult{}

	for _, did := range domainIDs {
		d, err := s.domainRepo.GetByID(ctx, did)
		if err != nil {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "domain not found"})
			continue
		}
		if d.OrgID != orgID {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "domain not found"})
			continue
		}

		// Check active inboxes
		if !force {
			activeCount, err := s.inboxRepo.CountActiveByDomain(ctx, did)
			if err == nil && activeCount > 0 {
				result.Skipped = append(result.Skipped, domain.BulkFailItem{DomainID: did, Reason: fmt.Sprintf("domain has %d active inboxes", activeCount)})
				continue
			}
		}

		// Clean up Redis inbox keys
		if s.redisInboxRepo != nil && s.inboxRepo != nil {
			addresses, err := s.inboxRepo.ListActiveAddressesByDomain(ctx, did)
			if err == nil {
				for _, addr := range addresses {
					_ = s.redisInboxRepo.Delete(ctx, addr)
				}
			}
		}

		if err := s.domainRepo.Delete(ctx, did); err != nil {
			result.Failed = append(result.Failed, domain.BulkFailItem{DomainID: did, Reason: "failed to delete"})
			continue
		}
		result.DeletedCount++
	}

	return result, nil
}

func (s *DomainService) TransferDomain(ctx context.Context, orgID, domainID, targetOrgID uuid.UUID) (*domain.TransferResult, error) {
	// Verify domain exists and belongs to source org
	d, err := s.domainRepo.GetByID(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if d.OrgID != orgID {
		return nil, fmt.Errorf("domain not found")
	}

	// Verify target org exists and has capacity
	targetOrg, err := s.orgRepo.GetByID(ctx, targetOrgID)
	if err != nil {
		return nil, fmt.Errorf("target organization not found")
	}

	maxDomains := s.cfg.RuntimeDefaults().MaxDomains
	if targetOrg.Settings.MaxDomains != nil {
		maxDomains = *targetOrg.Settings.MaxDomains
	}
	targetCount, err := s.domainRepo.CountByOrg(ctx, targetOrgID)
	if err != nil {
		return nil, err
	}
	if targetCount >= maxDomains {
		return nil, fmt.Errorf("target organization domain limit reached (%d)", maxDomains)
	}

	// Delete all domain assignments
	removedAssignments, err := s.domainRepo.DeleteAssignmentsByDomain(ctx, domainID)
	if err != nil {
		return nil, fmt.Errorf("failed to remove assignments: %w", err)
	}

	// Clean up Redis keys and deactivate inboxes
	deactivatedInboxes := 0
	if s.redisInboxRepo != nil && s.inboxRepo != nil {
		addresses, err := s.inboxRepo.ListActiveAddressesByDomain(ctx, domainID)
		if err == nil {
			for _, addr := range addresses {
				_ = s.redisInboxRepo.Delete(ctx, addr)
			}
		}
	}
	count, err := s.domainRepo.DeactivateInboxesByDomain(ctx, domainID)
	if err != nil {
		return nil, fmt.Errorf("failed to deactivate inboxes: %w", err)
	}
	deactivatedInboxes = count

	// Update org_id
	if err := s.domainRepo.UpdateOrgID(ctx, domainID, targetOrgID); err != nil {
		return nil, fmt.Errorf("failed to transfer domain: %w", err)
	}

	d.OrgID = targetOrgID
	d.Status = ComputeStatus(d)
	d.VerificationRecord = dnspkg.GenerateVerificationRecord(d.ID.String())

	return &domain.TransferResult{
		Domain:                  d,
		RemovedAssignmentsCount: removedAssignments,
		DeactivatedInboxesCount: deactivatedInboxes,
	}, nil
}

func (s *DomainService) GetVerificationHistory(ctx context.Context, orgID, domainID uuid.UUID, page, perPage int) ([]domain.VerificationHistory, int, error) {
	// Verify domain belongs to org
	d, err := s.domainRepo.GetByID(ctx, domainID)
	if err != nil {
		return nil, 0, err
	}
	if d.OrgID != orgID {
		return nil, 0, fmt.Errorf("domain not found")
	}

	return s.verHistoryRepo.ListByDomain(ctx, domainID, page, perPage)
}
