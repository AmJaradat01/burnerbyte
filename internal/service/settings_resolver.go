package service

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
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
	if err == nil && dom.Settings.AttachmentsEnabled != nil && *dom.Settings.AttachmentsEnabled != "inherit" {
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
