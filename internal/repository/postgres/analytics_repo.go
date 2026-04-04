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

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.TotalEmails); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1 AND i.is_active = TRUE`, orgID).Scan(&stats.ActiveInboxes); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.TotalInboxes); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains WHERE org_id = $1`, orgID).Scan(&stats.TotalDomains); err != nil {
		return nil, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&stats.TotalTeams); err != nil {
		return nil, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM org_memberships WHERE org_id = $1`, orgID).Scan(&stats.TotalMembers); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(e.size_bytes), 0) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id WHERE d.org_id = $1`, orgID).Scan(&stats.StorageUsedBytes); err != nil {
		return nil, err
	}

	rows, err := r.db.Query(ctx,
		`SELECT SPLIT_PART(e.from_address, '@', 2) AS sender_domain, COUNT(*) AS cnt
		 FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains d ON da.domain_id = d.id
		 WHERE d.org_id = $1 AND e.from_address LIKE '%@%'
		 GROUP BY sender_domain ORDER BY cnt DESC LIMIT 5`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sd domain.SenderDomain
		if err := rows.Scan(&sd.Domain, &sd.Count); err != nil {
			return nil, err
		}
		stats.TopSenderDomains = append(stats.TopSenderDomains, sd)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return stats, nil
}

func (r *AnalyticsRepo) GetTeamStats(ctx context.Context, teamID uuid.UUID) (*domain.TeamStats, error) {
	stats := &domain.TeamStats{}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = $1`, teamID).Scan(&stats.TotalEmails); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.is_active = TRUE`, teamID).Scan(&stats.ActiveInboxes); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1`, teamID).Scan(&stats.TotalInboxes); err != nil {
		return nil, err
	}

	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM team_memberships WHERE team_id = $1`, teamID).Scan(&stats.TotalMembers); err != nil {
		return nil, err
	}

	return stats, nil
}

func (r *AnalyticsRepo) GetSystemStats(ctx context.Context) (*domain.SystemStats, error) {
	stats := &domain.SystemStats{}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM organizations`).Scan(&stats.TotalOrgs); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams`).Scan(&stats.TotalTeams); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains`).Scan(&stats.TotalDomains); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM emails`).Scan(&stats.TotalEmails); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes`).Scan(&stats.TotalInboxes); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes WHERE is_active = TRUE`).Scan(&stats.ActiveInboxes); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&stats.TotalSessions); err != nil { return nil, err }
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
		if err := rows.Scan(&p.Date, &p.Count); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
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
		if err := rows.Scan(&p.Date, &p.Count); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}
