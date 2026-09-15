package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/mailer"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: invite-team-assignment + invite-auth-provisioning — DB integration
// tests for the transaction-bound flows (AcceptInvite multi-team membership
// creation, invite revocation cascade) that the mock harness can't reach.
// Run against the local test DB; skip when none is reachable.
// ===========================================================================

func svcTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:password@localhost:5432/burnerbyte_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("integration test DB unavailable (%v); set TEST_DATABASE_URL to run", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("integration test DB not reachable (%v); set TEST_DATABASE_URL to run", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newOrgSvcDB(pool *pgxpool.Pool) *OrgService {
	return NewOrgService(pool,
		postgres.NewOrgRepo(pool), postgres.NewTeamRepo(pool), postgres.NewUserRepo(pool),
		nil, nil, "", 0)
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func seedOrg2(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	id := uuid.New()
	mustExec(t, pool, `INSERT INTO organizations (id, name, slug, settings) VALUES ($1,$2,$3,'{}'::jsonb)`,
		id, "Org "+id.String()[:8], "org-"+id.String()[:8])
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, email string) uuid.UUID {
	id := uuid.New()
	mustExec(t, pool, `INSERT INTO users (id, email, display_name, email_verified) VALUES ($1,$2,$3,false)`,
		id, email, "User "+id.String()[:8])
	return id
}

func seedTeam(t *testing.T, pool *pgxpool.Pool, orgID uuid.UUID, archived bool) uuid.UUID {
	id := uuid.New()
	mustExec(t, pool, `INSERT INTO teams (id, org_id, name, slug, is_archived, settings) VALUES ($1,$2,$3,$4,$5,'{}'::jsonb)`,
		id, orgID, "Team "+id.String()[:8], "team-"+id.String()[:8], archived)
	return id
}

func seedInvite(t *testing.T, pool *pgxpool.Pool, orgID uuid.UUID, email, token string) uuid.UUID {
	id := uuid.New()
	mustExec(t, pool,
		`INSERT INTO invites (id, org_id, email, org_role, token, expires_at, allowed_auth)
		 VALUES ($1,$2,$3,'member',$4,$5,'["any"]'::jsonb)`,
		id, orgID, email, postgres.HashToken(token), time.Now().Add(48*time.Hour))
	return id
}

func seedInviteTeam(t *testing.T, pool *pgxpool.Pool, inviteID, teamID uuid.UUID, role string) {
	mustExec(t, pool, `INSERT INTO invite_team_assignments (id, invite_id, team_id, team_role) VALUES ($1,$2,$3,$4)`,
		uuid.New(), inviteID, teamID, role)
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	return n
}

// Property 6: AcceptInvite creates team memberships for exactly the non-archived
// assigned teams; archived teams are skipped.
func TestIntegration_AcceptInvite_MultiTeamSkipsArchived(t *testing.T) {
	pool := svcTestPool(t)
	ctx := context.Background()
	svc := newOrgSvcDB(pool)

	orgID := seedOrg2(t, pool)
	email := "accept-" + uuid.New().String()[:8] + "@corp.com"
	userID := seedUser(t, pool, email)
	teamActive := seedTeam(t, pool, orgID, false)
	teamArchived := seedTeam(t, pool, orgID, true)
	token := "tok-" + uuid.New().String()
	inviteID := seedInvite(t, pool, orgID, email, token)
	seedInviteTeam(t, pool, inviteID, teamActive, "member")
	seedInviteTeam(t, pool, inviteID, teamArchived, "lead")

	if _, err := svc.AcceptInvite(ctx, token, userID, email); err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}

	if n := count(t, pool, `SELECT COUNT(*) FROM org_memberships WHERE user_id=$1 AND org_id=$2`, userID, orgID); n != 1 {
		t.Errorf("org membership count = %d, want 1", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM team_memberships WHERE user_id=$1 AND team_id=$2`, userID, teamActive); n != 1 {
		t.Errorf("active-team membership = %d, want 1", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM team_memberships WHERE user_id=$1 AND team_id=$2`, userID, teamArchived); n != 0 {
		t.Errorf("archived-team membership = %d, want 0 (must be skipped)", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM invites WHERE id=$1 AND accepted_at IS NOT NULL`, inviteID); n != 1 {
		t.Errorf("invite should be marked accepted")
	}
}

// Property 15/16: cascade on team archive/delete revokes invites whose ONLY
// assignment was that team, and prunes the team from multi-team invites while
// leaving the rest of the invite intact.
func TestIntegration_CascadeTeamInviteRevocation(t *testing.T) {
	pool := svcTestPool(t)
	ctx := context.Background()
	svc := newOrgSvcDB(pool)

	orgID := seedOrg2(t, pool)
	teamGone := seedTeam(t, pool, orgID, false) // the team being archived/deleted
	teamKeep := seedTeam(t, pool, orgID, false)

	// invite1: only assigned to teamGone → should be fully revoked.
	soloInvite := seedInvite(t, pool, orgID, "solo@corp.com", "tok-solo-"+uuid.New().String())
	seedInviteTeam(t, pool, soloInvite, teamGone, "member")

	// invite2: assigned to teamGone + teamKeep → only the teamGone assignment removed.
	multiInvite := seedInvite(t, pool, orgID, "multi@corp.com", "tok-multi-"+uuid.New().String())
	seedInviteTeam(t, pool, multiInvite, teamGone, "member")
	seedInviteTeam(t, pool, multiInvite, teamKeep, "lead")

	if err := svc.CascadeTeamInviteRevocation(ctx, teamGone); err != nil {
		t.Fatalf("CascadeTeamInviteRevocation: %v", err)
	}

	if n := count(t, pool, `SELECT COUNT(*) FROM invites WHERE id=$1`, soloInvite); n != 0 {
		t.Errorf("solo invite should be fully revoked, found %d", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM invites WHERE id=$1`, multiInvite); n != 1 {
		t.Errorf("multi-team invite should survive, found %d", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM invite_team_assignments WHERE invite_id=$1 AND team_id=$2`, multiInvite, teamGone); n != 0 {
		t.Errorf("the archived team's assignment should be pruned, found %d", n)
	}
	if n := count(t, pool, `SELECT COUNT(*) FROM invite_team_assignments WHERE invite_id=$1 AND team_id=$2`, multiInvite, teamKeep); n != 1 {
		t.Errorf("the surviving team's assignment must remain, found %d", n)
	}
}

// Property 11/12: bulk invite is complete (Created + Skipped + Failed == N
// non-blank emails), dedups within the request, and skips existing members.
func TestIntegration_BulkInvite_CompletenessAndSkips(t *testing.T) {
	pool := svcTestPool(t)
	ctx := context.Background()
	bypassDNS(t)

	ml, err := mailer.New(config.MailerConfig{}) // Host empty -> Send is a logging no-op
	if err != nil {
		t.Fatalf("mailer: %v", err)
	}
	orgID := seedOrg2(t, pool)
	inviterID := seedUser(t, pool, "inviter-"+uuid.New().String()[:8]+"@corp.com")
	svc := NewOrgService(pool, postgres.NewOrgRepo(pool), postgres.NewTeamRepo(pool),
		postgres.NewUserRepo(pool), nil, ml, "http://test.local", 0)

	// An existing org member who must be skipped as already_member.
	memberEmail := "member-" + uuid.New().String()[:8] + "@corp.com"
	memberID := seedUser(t, pool, memberEmail)
	mustExec(t, pool, `INSERT INTO org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'member')`,
		uuid.New(), memberID, orgID)

	new1 := "bulk1-" + uuid.New().String()[:8] + "@corp.com"
	new2 := "bulk2-" + uuid.New().String()[:8] + "@corp.com"
	input := domain.BulkInviteMemberInput{
		OrgRole: "member",
		Emails:  []string{memberEmail, new1, new2, new1, "   "}, // existing, two new, a dup, a blank
	}

	res, err := svc.BulkInviteMembers(ctx, orgID, input, inviterID)
	if err != nil {
		t.Fatalf("BulkInviteMembers: %v", err)
	}

	// Completeness: every non-blank email is accounted for exactly once.
	const nonBlank = 4
	if res.Created+len(res.Skipped)+len(res.Failed) != nonBlank {
		t.Errorf("completeness: Created(%d)+Skipped(%d)+Failed(%d) != %d",
			res.Created, len(res.Skipped), len(res.Failed), nonBlank)
	}
	if res.Created != 2 {
		t.Errorf("Created = %d, want 2 (the two distinct new emails)", res.Created)
	}
	reasons := map[string]int{}
	for _, s := range res.Skipped {
		reasons[s.Reason]++
	}
	if reasons["already_member"] != 1 {
		t.Errorf("expected one already_member skip, got %+v", res.Skipped)
	}
	if reasons["duplicate_in_request"] != 1 {
		t.Errorf("expected one duplicate_in_request skip, got %+v", res.Skipped)
	}
	// Exactly two pending invites persisted for this org.
	if n := count(t, pool, `SELECT COUNT(*) FROM invites WHERE org_id=$1 AND accepted_at IS NULL`, orgID); n != 2 {
		t.Errorf("persisted invites = %d, want 2", n)
	}
}
