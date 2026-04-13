package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type CounterRepo struct {
	db database.DBTX
}

func NewCounterRepo(db database.DBTX) *CounterRepo {
	return &CounterRepo{db: db}
}

func (r *CounterRepo) IncrementEmail(ctx context.Context, orgID uuid.UUID, sizeBytes int64) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO org_analytics_counters (org_id, total_emails_received, total_storage_bytes, updated_at)
		 VALUES ($1, 1, $2, NOW())
		 ON CONFLICT (org_id) DO UPDATE SET
		   total_emails_received = org_analytics_counters.total_emails_received + 1,
		   total_storage_bytes = org_analytics_counters.total_storage_bytes + $2,
		   updated_at = NOW()`, orgID, sizeBytes)
	return err
}

func (r *CounterRepo) IncrementInbox(ctx context.Context, orgID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO org_analytics_counters (org_id, total_inboxes_created, updated_at)
		 VALUES ($1, 1, NOW())
		 ON CONFLICT (org_id) DO UPDATE SET
		   total_inboxes_created = org_analytics_counters.total_inboxes_created + 1,
		   updated_at = NOW()`, orgID)
	return err
}

func (r *CounterRepo) GetCounters(ctx context.Context, orgID uuid.UUID) (*domain.OrgCounters, error) {
	c := &domain.OrgCounters{}
	err := r.db.QueryRow(ctx,
		`SELECT total_emails_received, total_inboxes_created, total_storage_bytes
		 FROM org_analytics_counters WHERE org_id = $1`, orgID).
		Scan(&c.TotalEmailsReceived, &c.TotalInboxesCreated, &c.TotalStorageBytes)
	if err != nil {
		return c, nil // return zeroes if no row
	}
	return c, nil
}

func (r *CounterRepo) UpsertDailyStat(ctx context.Context, orgID uuid.UUID, emailsReceived, inboxesCreated int, storageBytes int64) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO daily_email_stats (org_id, date, emails_received, inboxes_created, storage_bytes)
		 VALUES ($1, NOW()::date, $2, $3, $4)
		 ON CONFLICT (org_id, date) DO UPDATE SET
		   emails_received = daily_email_stats.emails_received + $2,
		   inboxes_created = daily_email_stats.inboxes_created + $3,
		   storage_bytes = daily_email_stats.storage_bytes + $4`, orgID, emailsReceived, inboxesCreated, storageBytes)
	return err
}

func (r *CounterRepo) GetDailyStats(ctx context.Context, orgID uuid.UUID, days int) ([]domain.DailyStat, error) {
	rows, err := r.db.Query(ctx,
		`SELECT date, emails_received, inboxes_created, storage_bytes
		 FROM daily_email_stats
		 WHERE org_id = $1 AND date >= NOW()::date - make_interval(days => $2)
		 ORDER BY date`, orgID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stats []domain.DailyStat
	for rows.Next() {
		var s domain.DailyStat
		var d time.Time
		if err := rows.Scan(&d, &s.EmailsReceived, &s.InboxesCreated, &s.StorageBytes); err != nil {
			return nil, err
		}
		s.Date = d.Format("2006-01-02")
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (r *CounterRepo) UpsertHourlyStat(ctx context.Context, orgID uuid.UUID, hour int) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO hourly_email_stats (org_id, date, hour, emails_received)
		 VALUES ($1, NOW()::date, $2, 1)
		 ON CONFLICT (org_id, date, hour) DO UPDATE SET
		   emails_received = hourly_email_stats.emails_received + 1`, orgID, hour)
	return err
}

func (r *CounterRepo) UpsertDomainStat(ctx context.Context, orgID uuid.UUID, domainName string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO daily_domain_email_stats (org_id, date, domain_name, emails_received)
		 VALUES ($1, NOW()::date, $2, 1)
		 ON CONFLICT (org_id, date, domain_name) DO UPDATE SET
		   emails_received = daily_domain_email_stats.emails_received + 1`, orgID, domainName)
	return err
}

func (r *CounterRepo) UpsertSenderDomainStat(ctx context.Context, orgID uuid.UUID, senderDomain string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO daily_sender_domain_stats (org_id, date, sender_domain, emails_received)
		 VALUES ($1, NOW()::date, $2, 1)
		 ON CONFLICT (org_id, date, sender_domain) DO UPDATE SET
		   emails_received = daily_sender_domain_stats.emails_received + 1`, orgID, senderDomain)
	return err
}

func (r *CounterRepo) UpsertDailyTeamStat(ctx context.Context, teamID uuid.UUID, emailsReceived, inboxesCreated int, storageBytes int64) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO daily_team_email_stats (team_id, date, emails_received, inboxes_created, storage_bytes)
		 VALUES ($1, NOW()::date, $2, $3, $4)
		 ON CONFLICT (team_id, date) DO UPDATE SET
		   emails_received = daily_team_email_stats.emails_received + $2,
		   inboxes_created = daily_team_email_stats.inboxes_created + $3,
		   storage_bytes = daily_team_email_stats.storage_bytes + $4`, teamID, emailsReceived, inboxesCreated, storageBytes)
	return err
}

func (r *CounterRepo) IncrementTeamEmail(ctx context.Context, teamID uuid.UUID, sizeBytes int64) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO team_analytics_counters (team_id, total_emails_received, total_storage_bytes, updated_at)
		 VALUES ($1, 1, $2, NOW())
		 ON CONFLICT (team_id) DO UPDATE SET
		   total_emails_received = team_analytics_counters.total_emails_received + 1,
		   total_storage_bytes = team_analytics_counters.total_storage_bytes + $2,
		   updated_at = NOW()`, teamID, sizeBytes)
	return err
}

func (r *CounterRepo) IncrementTeamInbox(ctx context.Context, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO team_analytics_counters (team_id, total_inboxes_created, updated_at)
		 VALUES ($1, 1, NOW())
		 ON CONFLICT (team_id) DO UPDATE SET
		   total_inboxes_created = team_analytics_counters.total_inboxes_created + 1,
		   updated_at = NOW()`, teamID)
	return err
}
