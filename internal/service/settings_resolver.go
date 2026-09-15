package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// SettingsResolver walks the cascade: assignment → domain → org → system default.
type SettingsResolver struct {
	assignmentRepo *postgres.DomainAssignmentRepo
	domainRepo     *postgres.DomainRepo
	orgRepo        *postgres.OrgRepo
	defaults       config.DefaultsConfig
}

func NewSettingsResolver(
	assignmentRepo *postgres.DomainAssignmentRepo,
	domainRepo *postgres.DomainRepo,
	orgRepo *postgres.OrgRepo,
	defaults config.DefaultsConfig,
) *SettingsResolver {
	return &SettingsResolver{
		assignmentRepo: assignmentRepo,
		domainRepo:     domainRepo,
		orgRepo:        orgRepo,
		defaults:       defaults,
	}
}

// ResolveAttachmentsEnabled walks the cascade for the attachments_enabled setting.
func (r *SettingsResolver) ResolveAttachmentsEnabled(ctx context.Context, assignmentID uuid.UUID) (bool, error) {
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return r.defaults.AttachmentsEnabled, err
	}

	// 1. Assignment level
	if assignment.Settings.AttachmentsEnabled != nil && *assignment.Settings.AttachmentsEnabled != "inherit" {
		return *assignment.Settings.AttachmentsEnabled == "enabled", nil
	}

	// 2. Domain level
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.AttachmentsEnabled, nil
	}
	if dom.Settings.AttachmentsEnabled != nil && *dom.Settings.AttachmentsEnabled != "inherit" {
		return *dom.Settings.AttachmentsEnabled == "enabled", nil
	}

	// 3. Org level
	org, err := r.orgRepo.GetByID(ctx, dom.OrgID)
	if err == nil && org.Settings.AttachmentsEnabled != nil {
		return *org.Settings.AttachmentsEnabled, nil
	}

	// 4. System default
	return r.defaults.AttachmentsEnabled, nil
}

// ResolveDefaultInboxTTL returns the default TTL for new inboxes.
// Cascade: domain → org → system default.
func (r *SettingsResolver) ResolveDefaultInboxTTL(ctx context.Context, assignmentID uuid.UUID) time.Duration {
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return r.defaults.DefaultInboxTTL
	}

	// 1. Domain level
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.DefaultInboxTTL
	}
	if dom.Settings.DefaultInboxTTL != nil {
		if d, err := time.ParseDuration(*dom.Settings.DefaultInboxTTL); err == nil {
			return d
		}
	}

	// 2. Org level
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.DefaultInboxTTL != nil {
		if d, err := time.ParseDuration(*org.Settings.DefaultInboxTTL); err == nil {
			return d
		}
	}

	// 3. System default
	return r.defaults.DefaultInboxTTL
}

// ResolveDefaultInboxTTLWithTeam returns the default TTL for new inboxes with team-level override.
// Cascade: team → domain → org → system default.
func (r *SettingsResolver) ResolveDefaultInboxTTLWithTeam(ctx context.Context, assignmentID uuid.UUID, teamSettings *domain.TeamSettings) time.Duration {
	// 1. Team level
	if teamSettings != nil && teamSettings.DefaultInboxTTL != nil {
		if d, err := time.ParseDuration(*teamSettings.DefaultInboxTTL); err == nil {
			return d
		}
	}
	// 2. Fall through to domain → org → system default
	return r.ResolveDefaultInboxTTL(ctx, assignmentID)
}

// ResolveMaxInboxTTL returns the maximum allowed TTL.
// Cascade: assignment → domain → org → system default.
func (r *SettingsResolver) ResolveMaxInboxTTL(ctx context.Context, assignmentID uuid.UUID) time.Duration {
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return r.defaults.MaxInboxTTL
	}
	// 1. Assignment level
	if assignment.Settings.MaxInboxTTL != nil {
		if d, err := time.ParseDuration(*assignment.Settings.MaxInboxTTL); err == nil {
			return d
		}
	}

	// 2. Domain level
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.MaxInboxTTL
	}
	if dom.Settings.MaxInboxTTL != nil {
		if d, err := time.ParseDuration(*dom.Settings.MaxInboxTTL); err == nil {
			return d
		}
	}

	// 3. Org level
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.MaxInboxTTL != nil {
		if d, err := time.ParseDuration(*org.Settings.MaxInboxTTL); err == nil {
			return d
		}
	}

	// 4. System default
	return r.defaults.MaxInboxTTL
}

// ResolveMaxAttachmentSize returns the max attachment size in bytes.
func (r *SettingsResolver) ResolveMaxAttachmentSize(ctx context.Context, assignmentID uuid.UUID) int {
	mb := r.defaults.MaxAttachmentSizeMB
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return mb * 1024 * 1024
	}
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return mb * 1024 * 1024
	}
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.MaxAttachmentSizeMB != nil {
		mb = *org.Settings.MaxAttachmentSizeMB
	}
	return mb * 1024 * 1024
}

// ResolveMaxInboxesPerDomain returns the max inboxes per domain.
// Cascade: domain → org → system default.
func (r *SettingsResolver) ResolveMaxInboxesPerDomain(ctx context.Context, assignmentID uuid.UUID) int {
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return r.defaults.MaxInboxesPerDomain
	}

	// 1. Domain level
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.MaxInboxesPerDomain
	}
	if dom.Settings.MaxInboxesPerDomain != nil {
		return *dom.Settings.MaxInboxesPerDomain
	}

	// 2. Org level
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.MaxInboxesPerDomain != nil {
		return *org.Settings.MaxInboxesPerDomain
	}

	// 3. System default
	return r.defaults.MaxInboxesPerDomain
}
