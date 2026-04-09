package postgres

import (
	"context"
	"time"

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
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams`).Scan(&stats.TotalTeams); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains`).Scan(&stats.TotalDomains); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM emails`).Scan(&stats.TotalEmails); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes`).Scan(&stats.TotalInboxes); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM inboxes WHERE is_active = TRUE AND expires_at > NOW()`).Scan(&stats.ActiveInboxes); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM sessions WHERE revoked = FALSE AND expires_at > NOW()`).Scan(&stats.TotalSessions); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(inboxes_created_count), 0) FROM domains`).Scan(&stats.TotalInboxesCreated); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(size_bytes), 0) FROM emails`).Scan(&stats.StorageUsedBytes); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM webhooks`).Scan(&stats.TotalWebhooks); err != nil { return nil, err }
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE (expires_at IS NULL OR expires_at > NOW())`).Scan(&stats.TotalAPIKeys); err != nil { return nil, err }
	return stats, nil
}

func (r *AnalyticsRepo) GetOrgEmailsPerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT d::date, COALESCE(sub.cnt, 0) FROM generate_series(
		  (NOW() - make_interval(days => $2))::date, NOW()::date, '1 day'::interval
		) d LEFT JOIN (
		  SELECT DATE(e.received_at) as dt, COUNT(*) as cnt FROM emails e
		  JOIN inboxes i ON e.inbox_id = i.id
		  JOIN domain_assignments da ON i.domain_assignment_id = da.id
		  JOIN domains dm ON da.domain_id = dm.id
		  WHERE dm.org_id = $1 AND e.received_at > NOW() - make_interval(days => $2)
		  GROUP BY dt
		) sub ON d::date = sub.dt ORDER BY d`, orgID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		var date time.Time
		if err := rows.Scan(&date, &p.Count); err != nil {
			return nil, err
		}
		p.Date = date.Format("2006-01-02")
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

func (r *AnalyticsRepo) GetOrgInboxesPerDay(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT d::date, COALESCE(sub.cnt, 0) FROM generate_series(
		  (NOW() - make_interval(days => $2))::date, NOW()::date, '1 day'::interval
		) d LEFT JOIN (
		  SELECT DATE(i.created_at) as dt, COUNT(*) as cnt FROM inboxes i
		  JOIN domain_assignments da ON i.domain_assignment_id = da.id
		  JOIN domains dm ON da.domain_id = dm.id
		  WHERE dm.org_id = $1 AND i.created_at > NOW() - make_interval(days => $2)
		  GROUP BY dt
		) sub ON d::date = sub.dt ORDER BY d`, orgID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		var date time.Time
		if err := rows.Scan(&date, &p.Count); err != nil {
			return nil, err
		}
		p.Date = date.Format("2006-01-02")
		points = append(points, p)
	}
	return points, rows.Err()
}

func (r *AnalyticsRepo) GetOrgPeakHours(ctx context.Context, orgID uuid.UUID, days ...int) ([]domain.HourlyPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT EXTRACT(HOUR FROM e.received_at)::int as hour, COUNT(*) as cnt
		 FROM emails e JOIN inboxes i ON e.inbox_id = i.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 JOIN domains dm ON da.domain_id = dm.id
		 WHERE dm.org_id = $1 AND e.received_at > NOW() - make_interval(days => $2)
		 GROUP BY hour ORDER BY hour`, orgID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hourMap := make(map[int]int64)
	for rows.Next() {
		var h int
		var c int64
		if err := rows.Scan(&h, &c); err != nil {
			return nil, err
		}
		hourMap[h] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	points := make([]domain.HourlyPoint, 24)
	for i := 0; i < 24; i++ {
		points[i] = domain.HourlyPoint{Hour: i, Count: hourMap[i]}
	}
	return points, nil
}

func (r *AnalyticsRepo) GetOrgDomainBreakdown(ctx context.Context, orgID uuid.UUID) ([]domain.DomainBreakdown, error) {
	rows, err := r.db.Query(ctx,
		`SELECT dm.domain_name, COUNT(e.id) as cnt
		 FROM domains dm
		 LEFT JOIN domain_assignments da ON da.domain_id = dm.id
		 LEFT JOIN inboxes i ON i.domain_assignment_id = da.id
		 LEFT JOIN emails e ON e.inbox_id = i.id
		 WHERE dm.org_id = $1
		 GROUP BY dm.domain_name ORDER BY cnt DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []domain.DomainBreakdown
	for rows.Next() {
		var db domain.DomainBreakdown
		if err := rows.Scan(&db.Domain, &db.Count); err != nil {
			return nil, err
		}
		results = append(results, db)
	}
	return results, rows.Err()
}

func (r *AnalyticsRepo) GetTeamEmailsPerDay(ctx context.Context, teamID uuid.UUID, days ...int) ([]domain.TimeSeriesPoint, error) {
	d := 30
	if len(days) > 0 && days[0] > 0 { d = days[0] }
	rows, err := r.db.Query(ctx,
		`SELECT d::date, COALESCE(sub.cnt, 0) FROM generate_series(
		  (NOW() - make_interval(days => $2))::date, NOW()::date, '1 day'::interval
		) d LEFT JOIN (
		  SELECT DATE(e.received_at) as dt, COUNT(*) as cnt FROM emails e
		  JOIN inboxes i ON e.inbox_id = i.id
		  JOIN domain_assignments da ON i.domain_assignment_id = da.id
		  WHERE da.team_id = $1 AND e.received_at > NOW() - make_interval(days => $2)
		  GROUP BY dt
		) sub ON d::date = sub.dt ORDER BY d`, teamID, d)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []domain.TimeSeriesPoint
	for rows.Next() {
		var p domain.TimeSeriesPoint
		var date time.Time
		if err := rows.Scan(&date, &p.Count); err != nil {
			return nil, err
		}
		p.Date = date.Format("2006-01-02")
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}
