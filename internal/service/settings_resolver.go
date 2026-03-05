package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
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
// Cascade: org → system default.
func (r *SettingsResolver) ResolveDefaultInboxTTL(ctx context.Context, assignmentID uuid.UUID) time.Duration {
	assignment, err := r.assignmentRepo.GetByID(ctx, assignmentID)
	if err != nil {
		return r.defaults.DefaultInboxTTL
	}
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.DefaultInboxTTL
	}
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.DefaultInboxTTL != nil {
		if d, err := time.ParseDuration(*org.Settings.DefaultInboxTTL); err == nil {
			return d
		}
	}
	return r.defaults.DefaultInboxTTL
}

// ResolveMaxInboxTTL returns the maximum allowed TTL.
// Cascade: assignment → org → system default.
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
	// 2. Org level
	dom, err := r.domainRepo.GetByID(ctx, assignment.DomainID)
	if err != nil {
		return r.defaults.MaxInboxTTL
	}
	org, _ := r.orgRepo.GetByID(ctx, dom.OrgID)
	if org != nil && org.Settings.MaxInboxTTL != nil {
		if d, err := time.ParseDuration(*org.Settings.MaxInboxTTL); err == nil {
			return d
		}
	}
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
