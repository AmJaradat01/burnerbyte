package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// Inbox list search filters by full_address (case-insensitive substring) and
// leaves the pagination params correct (the search arg shifts LIMIT/OFFSET).
func TestIntegration_InboxSearch(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewInboxRepo(pool)
	orgID := seedOrg(t, pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed exec: %v", err)
		}
	}

	userID := uuid.New()
	exec(`INSERT INTO users (id, email, display_name, email_verified) VALUES ($1,$2,$3,true)`,
		userID, "ibx-"+userID.String()[:8]+"@corp.com", "U")
	teamID := uuid.New()
	exec(`INSERT INTO teams (id, org_id, name, slug, settings) VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
		teamID, orgID, "T", "t-"+teamID.String()[:8])
	domainID := uuid.New()
	exec(`INSERT INTO domains (id, org_id, domain_name) VALUES ($1,$2,$3)`,
		domainID, orgID, "ex-"+domainID.String()[:8]+".com")
	daID := uuid.New()
	exec(`INSERT INTO domain_assignments (id, team_id, domain_id, access_level, settings) VALUES ($1,$2,$3,'full','{}'::jsonb)`,
		daID, teamID, domainID)

	// Unique per run (hex prefix can't contain the search terms) so the
	// full_address unique constraint never collides across runs.
	uniq := userID.String()[:8]
	alphaAddr := uniq + "-alpha"
	betaAddr := uniq + "-beta"
	mkInbox := func(addr string) {
		exec(`INSERT INTO inboxes (id, domain_assignment_id, domain_id, created_by, address, full_address, is_active, expires_at)
		      VALUES ($1,$2,$3,$4,$5,$6,true, NOW() + interval '1 hour')`,
			uuid.New(), daID, domainID, userID, addr, addr+"@example.com")
	}
	mkInbox(alphaAddr)
	mkInbox(betaAddr)

	// Case-insensitive substring match on full_address.
	got, total, err := repo.ListByUserWithStatus(ctx, userID, "active", "ALPHA", 1, 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if total != 1 || len(got) != 1 || got[0].Address != alphaAddr {
		t.Fatalf("search 'ALPHA' = total %d, len %d, want exactly %s", total, len(got), alphaAddr)
	}

	// Empty search returns all of the user's active inboxes.
	all, totalAll, err := repo.ListByUserWithStatus(ctx, userID, "active", "", 1, 20)
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if totalAll != 2 || len(all) != 2 {
		t.Fatalf("no-search = total %d, len %d, want 2", totalAll, len(all))
	}
}
