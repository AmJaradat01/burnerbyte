package service

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type AnalyticsService struct {
	repo *postgres.AnalyticsRepo
}

func NewAnalyticsService(repo *postgres.AnalyticsRepo) *AnalyticsService {
	return &AnalyticsService{repo: repo}
}

func (s *AnalyticsService) GetOrgAnalytics(ctx context.Context, orgID uuid.UUID) (*domain.OrgStats, error) {
	return s.repo.GetOrgStats(ctx, orgID)
}

func (s *AnalyticsService) GetTeamAnalytics(ctx context.Context, teamID uuid.UUID) (*domain.TeamStats, error) {
	return s.repo.GetTeamStats(ctx, teamID)
}

func (s *AnalyticsService) GetSystemStats(ctx context.Context) (*domain.SystemStats, error) {
	return s.repo.GetSystemStats(ctx)
}

func (s *AnalyticsService) GetOrgEmailsPerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	return s.repo.GetOrgEmailsPerDay(ctx, orgID, days...)
}

func (s *AnalyticsService) GetTeamEmailsPerDay(ctx context.Context, teamID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	return s.repo.GetTeamEmailsPerDay(ctx, teamID, days...)
}

func (s *AnalyticsService) GetOrgInboxesPerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	return s.repo.GetOrgInboxesPerDay(ctx, orgID, days...)
}

func (s *AnalyticsService) GetOrgPeakHours(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.HourlyPoint, error) {
	return s.repo.GetOrgPeakHours(ctx, orgID, days...)
}

func (s *AnalyticsService) GetOrgDomainBreakdown(ctx context.Context, orgID uuid.UUID) ([]domain.DomainBreakdown, error) {
	return s.repo.GetOrgDomainBreakdown(ctx, orgID)
}

func (s *AnalyticsService) GetOrgStoragePerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.StoragePoint, error) {
	return s.repo.GetOrgStoragePerDay(ctx, orgID, days...)
}

func (s *AnalyticsService) GetOrgDomainTimeSeries(ctx context.Context, orgID uuid.UUID, domainName string, days ...int) ([]domain.TimeSeriesPoint, error) {
	return s.repo.GetOrgDomainTimeSeries(ctx, orgID, domainName, days...)
}

func (s *AnalyticsService) GetTeamInboxesPerDay(ctx context.Context, teamID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	return s.repo.GetTeamInboxesPerDay(ctx, teamID, days...)
}

func (s *AnalyticsService) GetTeamStoragePerDay(ctx context.Context, teamID uuid.UUID, days ...int) ([]domain.StoragePoint, error) {
	return s.repo.GetTeamStoragePerDay(ctx, teamID, days...)
}
