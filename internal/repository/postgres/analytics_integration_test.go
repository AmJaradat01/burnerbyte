package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ===========================================================================
// Feature: analytics-data-persistence — integration tests proving analytics
// survive email deletion because they read the persistent counter/dimension
// tables (org_analytics_counters, daily_email_stats, daily_sender_domain_stats)
// rather than live email rows. These run against the local test DB; they skip
// when none is reachable.
// ===========================================================================

// Property 1 (bug fixed): with persistent stats present and ZERO live emails
// (the post-deletion state), org analytics still return the historical values.
func TestIntegration_OrgAnalyticsSurviveEmailDeletion(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewAnalyticsRepo(pool)
	orgID := seedOrg(t, pool)
	today := time.Now().UTC().Truncate(24 * time.Hour)

	// Persistent counters: emails received and storage that were accumulated
	// before the emails were deleted.
	if _, err := pool.Exec(ctx,
		`INSERT INTO org_analytics_counters (org_id, total_emails_received, total_inboxes_created, total_storage_bytes)
		 VALUES ($1, $2, $3, $4)`, orgID, 5, 3, 123456); err != nil {
		t.Fatalf("seed counters: %v", err)
	}
	// Per-day dimension rows (no matching rows remain in the emails table).
	if _, err := pool.Exec(ctx,
		`INSERT INTO daily_email_stats (org_id, date, emails_received, inboxes_created, storage_bytes)
		 VALUES ($1, $2, $3, $4, $5)`, orgID, today, 10, 2, 5000); err != nil {
		t.Fatalf("seed daily_email_stats: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO daily_sender_domain_stats (org_id, date, sender_domain, emails_received)
		 VALUES ($1, $2, $3, $4)`, orgID, today, "stripe.com", 7); err != nil {
		t.Fatalf("seed sender domain stats: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO hourly_email_stats (org_id, date, hour, emails_received)
		 VALUES ($1, $2, $3, $4)`, orgID, today, 14, 4); err != nil {
		t.Fatalf("seed hourly stats: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO daily_domain_email_stats (org_id, date, domain_name, emails_received)
		 VALUES ($1, $2, $3, $4)`, orgID, today, "example.com", 6); err != nil {
		t.Fatalf("seed domain breakdown stats: %v", err)
	}

	// GetOrgStats reads persistent counters for TotalEmails / StorageUsedBytes.
	stats, err := repo.GetOrgStats(ctx, orgID)
	if err != nil {
		t.Fatalf("GetOrgStats: %v", err)
	}
	if stats.TotalEmails != 5 {
		t.Errorf("TotalEmails = %d, want 5 (from org_analytics_counters, not live emails)", stats.TotalEmails)
	}
	if stats.StorageUsedBytes != 123456 {
		t.Errorf("StorageUsedBytes = %d, want 123456 (persistent)", stats.StorageUsedBytes)
	}
	if len(stats.TopSenderDomains) == 0 || stats.TopSenderDomains[0].Domain != "stripe.com" {
		t.Errorf("TopSenderDomains = %+v, want stripe.com from persistent dimension table", stats.TopSenderDomains)
	}

	// GetOrgEmailsPerDay reads daily_email_stats for the time series.
	points, err := repo.GetOrgEmailsPerDay(ctx, orgID, 7)
	if err != nil {
		t.Fatalf("GetOrgEmailsPerDay: %v", err)
	}
	todayStr := today.Format("2006-01-02")
	var found bool
	for _, p := range points {
		if p.Date == todayStr {
			found = true
			if p.Count != 10 {
				t.Errorf("emails-per-day for %s = %d, want 10 (from daily_email_stats)", todayStr, p.Count)
			}
		}
	}
	if !found {
		t.Errorf("no time-series point for today (%s) in %+v", todayStr, points)
	}

	// GetOrgPeakHours reads hourly_email_stats.
	hours, err := repo.GetOrgPeakHours(ctx, orgID, 7)
	if err != nil {
		t.Fatalf("GetOrgPeakHours: %v", err)
	}
	if len(hours) != 24 || hours[14].Count != 4 {
		t.Errorf("peak hours[14] = %+v, want count 4 (from hourly_email_stats)", hours[14])
	}

	// GetOrgDomainBreakdown reads daily_domain_email_stats.
	breakdown, err := repo.GetOrgDomainBreakdown(ctx, orgID)
	if err != nil {
		t.Fatalf("GetOrgDomainBreakdown: %v", err)
	}
	if len(breakdown) == 0 || breakdown[0].Domain != "example.com" || breakdown[0].Count != 6 {
		t.Errorf("domain breakdown = %+v, want example.com=6 (from daily_domain_email_stats)", breakdown)
	}
}

// Property 2 (preservation): live entity counts still reflect the actual rows.
// With no domains/teams/members seeded, the live counts must read zero — proving
// the fix did not replace live-entity queries with stale counters.
func TestIntegration_OrgStatsLiveCountsUnaffected(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewAnalyticsRepo(pool)
	orgID := seedOrg(t, pool)

	// Seed a team and a member; leave domains/inboxes empty.
	teamID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO teams (id, org_id, name, slug, settings) VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
		teamID, orgID, "T", "t-"+teamID.String()[:8]); err != nil {
		t.Fatalf("seed team: %v", err)
	}

	stats, err := repo.GetOrgStats(ctx, orgID)
	if err != nil {
		t.Fatalf("GetOrgStats: %v", err)
	}
	if stats.TotalTeams != 1 {
		t.Errorf("TotalTeams = %d, want 1 (live count)", stats.TotalTeams)
	}
	if stats.TotalDomains != 0 || stats.TotalInboxes != 0 || stats.ActiveInboxes != 0 {
		t.Errorf("expected zero live domains/inboxes, got domains=%d inboxes=%d active=%d",
			stats.TotalDomains, stats.TotalInboxes, stats.ActiveInboxes)
	}
}
