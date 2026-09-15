package service

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type AuditService struct {
	repo *postgres.AuditRepo
}

func NewAuditService(repo *postgres.AuditRepo) *AuditService {
	return &AuditService{repo: repo}
}

func (s *AuditService) Record(ctx context.Context, entry *domain.AuditEntry) error {
	entry.ID = uuid.New()
	return s.repo.Create(ctx, entry)
}

func (s *AuditService) List(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter, page, perPage int) ([]domain.AuditEntry, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.repo.List(ctx, orgID, filter, page, perPage)
}

func (s *AuditService) ListAll(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter) ([]domain.AuditEntry, error) {
	return s.repo.ListAll(ctx, orgID, filter)
}

// ListPlatform returns paginated platform-level audit events (org_id IS NULL):
// registration, login, password reset, account deletion, session revocation.
func (s *AuditService) ListPlatform(ctx context.Context, filter domain.AuditFilter, page, perPage int) ([]domain.AuditEntry, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.repo.ListPlatform(ctx, filter, page, perPage)
}
