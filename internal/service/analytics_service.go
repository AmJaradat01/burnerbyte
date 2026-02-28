package service

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
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
