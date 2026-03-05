package postgres

import (
	"context"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type AnalyticsRepo struct {
	db database.DBTX
}

func NewAnalyticsRepo(db database.DBTX) *AnalyticsRepo {
	return &AnalyticsRepo{db: db}
}

func (r *AnalyticsRepo) GetOrgStats(ctx context.Context, orgID uuid.UUID) (*domain.OrgStats, error) {
	stats := &domain.OrgStats{}

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.TotalEmails)

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1 AND i.is_active = TRUE`, orgID).Scan(&stats.ActiveInboxes)

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.TotalInboxes)

	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains WHERE org_id = $1`, orgID).Scan(&stats.TotalDomains)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&stats.TotalTeams)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM org_memberships WHERE org_id = $1`, orgID).Scan(&stats.TotalMembers)

	_ = r.db.QueryRow(ctx,
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
			_ = rows.Scan(&p.Date, &p.Count)
			stats.EmailsPerDay = append(stats.EmailsPerDay, p)
		}
	}

	// Top sender domains
	senderRows, err := r.db.Query(ctx,
		`SELECT SPLIT_PART(e.from_address, '@', 2) AS sender_domain, COUNT(*) AS cnt
		 FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id
		 WHERE d.org_id = $1 AND e.from_address LIKE '%@%'
		 GROUP BY sender_domain ORDER BY cnt DESC LIMIT 5`, orgID)
	if err == nil {
		defer senderRows.Close()
		for senderRows.Next() {
			var sd domain.SenderDomain
			_ = senderRows.Scan(&sd.Domain, &sd.Count)
			stats.TopSenderDomains = append(stats.TopSenderDomains, sd)
		}
	}

	return stats, nil
}

func (r *AnalyticsRepo) GetTeamStats(ctx context.Context, teamID uuid.UUID) (*domain.TeamStats, error) {
	stats := &domain.TeamStats{}

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1`, teamID).Scan(&stats.TotalEmails)

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.is_active = TRUE`, teamID).Scan(&stats.ActiveInboxes)

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1`, teamID).Scan(&stats.TotalInboxes)

	_ = r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM team_memberships WHERE team_id = $1`, teamID).Scan(&stats.TotalMembers)

	return stats, nil
}

func (r *AnalyticsRepo) GetSystemStats(ctx context.Context) (*domain.SystemStats, error) {
	stats := &domain.SystemStats{}
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&stats.TotalOrgs)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams`).Scan(&stats.TotalTeams)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains`).Scan(&stats.TotalDomains)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM emails`).Scan(&stats.TotalEmails)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes`).Scan(&stats.TotalInboxes)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes WHERE is_active = TRUE`).Scan(&stats.ActiveInboxes)
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&stats.TotalSessions)
	return stats, nil
}

func (r *AnalyticsRepo) GetOrgEmailsPerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT DATE(e.received_at) as d, COUNT(*) FROM emails e
		 JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains dm ON da.domain_id = dm.id
		 WHERE dm.org_id = $1 AND e.received_at > NOW() - make_interval(days => $2)
		 GROUP BY d ORDER BY d`, orgID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		_ = rows.Scan(&p.Date, &p.Count)
		points = append(points, p)
	}
	return points, nil
}

func (r *AnalyticsRepo) GetTeamEmailsPerDay(ctx context.Context, teamID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT DATE(e.received_at) as d, COUNT(*) FROM emails e
		 JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND e.received_at > NOW() - make_interval(days => $2)
		 GROUP BY d ORDER BY d`, teamID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		_ = rows.Scan(&p.Date, &p.Count)
		points = append(points, p)
	}
	return points, nil
}
