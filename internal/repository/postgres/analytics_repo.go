package postgres

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type AnalyticsRepo struct {
	db database.DBTX
}

func NewAnalyticsRepo(db database.DBTX) *AnalyticsRepo {
	return &AnalyticsRepo{db: db}
}

func (r *AnalyticsRepo) GetOrgStats(ctx context.Context, orgID uuid.UUID) (*domain.OrgStats, error) {
	stats := &domain.OrgStats{}

	r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.TotalEmails)

	r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1 AND i.is_active = TRUE`, orgID).Scan(&stats.ActiveInboxes)

	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains WHERE org_id = $1`, orgID).Scan(&stats.TotalDomains)
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&stats.TotalTeams)
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM org_memberships WHERE org_id = $1`, orgID).Scan(&stats.TotalMembers)

	r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(e.size_bytes), 0) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.StorageUsedBytes)

	// Emails per day (last 30 days)
	rows, err := r.db.Query(ctx,
		`SELECT DATE(e.received_at) as d, COUNT(*) FROM emails e
		 JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains dm ON da.domain_id = dm.id
		 WHERE dm.org_id = $1 AND e.received_at > NOW() - INTERVAL '30 days'
		 GROUP BY d ORDER BY d`, orgID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p domain.TimeSeriesPoint
			rows.Scan(&p.Date, &p.Count)
			stats.EmailsPerDay = append(stats.EmailsPerDay, p)
		}
	}

	return stats, nil
}

func (r *AnalyticsRepo) GetTeamStats(ctx context.Context, teamID uuid.UUID) (*domain.TeamStats, error) {
	stats := &domain.TeamStats{}

	r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1`, teamID).Scan(&stats.TotalEmails)

	r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.is_active = TRUE`, teamID).Scan(&stats.ActiveInboxes)

	return stats, nil
}

func (r *AnalyticsRepo) GetSystemStats(ctx context.Context) (*domain.SystemStats, error) {
	stats := &domain.SystemStats{}
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers)
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&stats.TotalOrgs)
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM emails`).Scan(&stats.TotalEmails)
	r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes WHERE is_active = TRUE`).Scan(&stats.TotalInboxes)
	return stats, nil
}

func (r *AnalyticsRepo) GetOrgEmailsPerDay(ctx context.Context, orgID uuid.UUID) ([]domain.TimeSeriesPoint, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DATE(e.received_at) as d, COUNT(*) FROM emails e
		 JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains dm ON da.domain_id = dm.id
		 WHERE dm.org_id = $1 AND e.received_at > NOW() - INTERVAL '30 days'
		 GROUP BY d ORDER BY d`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		rows.Scan(&p.Date, &p.Count)
		points = append(points, p)
	}
	return points, nil
}

func (r *AnalyticsRepo) GetTeamEmailsPerDay(ctx context.Context, teamID uuid.UUID) ([]domain.TimeSeriesPoint, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DATE(e.received_at) as d, COUNT(*) FROM emails e
		 JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND e.received_at > NOW() - INTERVAL '30 days'
		 GROUP BY d ORDER BY d`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		rows.Scan(&p.Date, &p.Count)
		points = append(points, p)
	}
	return points, nil
}
