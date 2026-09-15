package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: enhanced-teams — service-layer unit tests (tasks 14.3–14.7).
// Uses the shared mockDBTX/mockRow/mockRows infrastructure from
// auth_service_test.go (same package).
// ===========================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTeamSvcWithDB creates a TeamService backed by the given mock DBTX.
func newTeamSvcWithDB(db *mockDBTX) *TeamService {
	teamRepo := postgres.NewTeamRepo(db)
	orgRepo := postgres.NewOrgRepo(db)
	userRepo := postgres.NewUserRepo(db)
	counterRepo := postgres.NewCounterRepo(db)
	cfg := &config.Config{}
	return NewTeamService(nil, teamRepo, orgRepo, userRepo, counterRepo, cfg)
}

// teamMembershipRow builds the 5-column row that TeamRepo.GetMembership scans:
// (id, user_id, team_id, role, created_at).
func teamMembershipRow(userID, teamID uuid.UUID, role string) *mockRow {
	return &mockRow{values: []any{
		uuid.New(),  // id
		userID,      // user_id
		teamID,      // team_id
		role,        // role
		time.Now(),  // created_at
	}}
}

// teamRow builds the 11-column row that TeamRepo.GetByID scans:
// (id, org_id, name, slug, description, avatar_url, is_archived, archived_at, settings, created_at, updated_at).
func teamRow(teamID, orgID uuid.UUID, isArchived bool) *mockRow {
	var archivedAt *time.Time
	if isArchived {
		t := time.Now()
		archivedAt = &t
	}
	settings, _ := json.Marshal(domain.TeamSettings{})
	return &mockRow{values: []any{
		teamID,          // id
		orgID,           // org_id
		"TestTeam",      // name
		"testteam",      // slug
		(*string)(nil),  // description
		(*string)(nil),  // avatar_url
		isArchived,      // is_archived
		archivedAt,      // archived_at
		settings,        // settings ([]byte)
		time.Now(),      // created_at
		time.Now(),      // updated_at
	}}
}

// teamOrgRow builds the 7-column row that OrgRepo.GetByID scans with MaxTeams set.
func teamOrgRow(orgID uuid.UUID, maxTeams int) *mockRow {
	s := domain.OrgSettings{MaxTeams: &maxTeams}
	settings, _ := json.Marshal(s)
	return &mockRow{values: []any{
		orgID,          // id
		"TestOrg",      // name
		"testorg",      // slug
		(*string)(nil), // logo_url
		settings,       // settings ([]byte)
		time.Now(),     // created_at
		time.Now(),     // updated_at
	}}
}

// countRow returns a mockRow for COUNT(*) queries.
func countRow(n int) *mockRow {
	return &mockRow{values: []any{n}}
}

// userRow builds the 17-column row that UserRepo.scanOne scans:
// (id, email, display_name, avatar_url, password_hash, sso_provider, sso_subject,
//  is_system_admin, email_verified, password_changed_at, timezone, date_format,
//  time_format, auth_method_lock, max_sessions, created_at, updated_at).
func userRow(email string) *mockRow {
	return &mockRow{values: []any{
		uuid.New(),          // id
		email,               // email
		"Test User",         // display_name
		(*string)(nil),      // avatar_url
		(*string)(nil),      // password_hash
		(*string)(nil),      // sso_provider
		(*string)(nil),      // sso_subject
		false,               // is_system_admin
		true,                // email_verified
		(*time.Time)(nil),   // password_changed_at
		(*string)(nil),      // timezone
		(*string)(nil),      // date_format
		(*string)(nil),      // time_format
		(*string)(nil),      // auth_method_lock
		(*int)(nil),         // max_sessions
		time.Now(),          // created_at
		time.Now(),          // updated_at
	}}
}

// buildAddMemberInputs converts simple email/role pairs to domain inputs.
func buildAddMemberInputs(members []struct{ email, role string }) []domain.AddTeamMemberInput {
	result := make([]domain.AddTeamMemberInput, len(members))
	for i, m := range members {
		result[i] = domain.AddTeamMemberInput{Email: m.email, Role: m.role}
	}
	return result
}

// ---------------------------------------------------------------------------
// 14.3 — LeaveTeam last-lead protection
// ---------------------------------------------------------------------------

func TestLeaveTeam_NonLeadCanLeave(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	userID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(userID, teamID, "member")
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("DELETE 1"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	err := svc.LeaveTeam(context.Background(), orgID, teamID, userID)
	if err != nil {
		t.Fatalf("expected non-lead to leave successfully, got: %v", err)
	}
}

func TestLeaveTeam_LeadCanLeaveWhenOtherLeadsExist(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	userID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(userID, teamID, "lead")
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(2)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("DELETE 1"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	err := svc.LeaveTeam(context.Background(), orgID, teamID, userID)
	if err != nil {
		t.Fatalf("expected lead to leave when other leads exist, got: %v", err)
	}
}

func TestLeaveTeam_LastLeadRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	userID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(userID, teamID, "lead")
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(1)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	err := svc.LeaveTeam(context.Background(), orgID, teamID, userID)
	if err == nil {
		t.Fatal("expected last lead to be rejected from leaving")
	}
	if !strings.Contains(err.Error(), "last lead") {
		t.Fatalf("expected 'last lead' error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 14.4 — BulkAddMembers partial-success semantics
// ---------------------------------------------------------------------------

func TestBulkAddMembers_MultipleValid(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM users WHERE email"):
				email := args[0].(string)
				return userRow(email)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	input := buildAddMemberInputs([]struct{ email, role string }{
		{"a@test.com", "member"},
		{"b@test.com", "lead"},
		{"c@test.com", "member"},
	})

	result, err := svc.BulkAddMembers(context.Background(), teamID, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.AddedCount != 3 {
		t.Fatalf("expected added_count=3, got %d", result.AddedCount)
	}
}

func TestBulkAddMembers_AlreadyExistingSkipped(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM users WHERE email"):
				email := args[0].(string)
				return userRow(email)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "INSERT INTO team_memberships") {
				return pgconn.CommandTag{}, &pgconn.PgError{Code: "23505"}
			}
			return pgconn.NewCommandTag("OK"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	input := buildAddMemberInputs([]struct{ email, role string }{
		{"existing@test.com", "member"},
	})

	result, err := svc.BulkAddMembers(context.Background(), teamID, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.AddedCount != 0 {
		t.Fatalf("expected added_count=0, got %d", result.AddedCount)
	}
	if len(result.Skipped) != 1 {
		t.Fatalf("expected 1 skipped, got %d", len(result.Skipped))
	}
	if !strings.Contains(result.Skipped[0].Reason, "already a member") {
		t.Fatalf("expected 'already a member' reason, got: %s", result.Skipped[0].Reason)
	}
}

func TestBulkAddMembers_UnresolvableEmailFailed(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM users WHERE email"):
				return &mockRow{err: pgx.ErrNoRows}
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	input := buildAddMemberInputs([]struct{ email, role string }{
		{"notfound@test.com", "member"},
	})

	result, err := svc.BulkAddMembers(context.Background(), teamID, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.AddedCount != 0 {
		t.Fatalf("expected added_count=0, got %d", result.AddedCount)
	}
	if len(result.Failed) != 1 {
		t.Fatalf("expected 1 failed, got %d", len(result.Failed))
	}
	if !strings.Contains(result.Failed[0].Reason, "not found") {
		t.Fatalf("expected 'not found' reason, got: %s", result.Failed[0].Reason)
	}
}

func TestBulkAddMembers_InvalidRoleFailed(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	input := buildAddMemberInputs([]struct{ email, role string }{
		{"user@test.com", "superadmin"},
	})

	result, err := svc.BulkAddMembers(context.Background(), teamID, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.AddedCount != 0 {
		t.Fatalf("expected added_count=0, got %d", result.AddedCount)
	}
	if len(result.Failed) != 1 {
		t.Fatalf("expected 1 failed, got %d", len(result.Failed))
	}
	if !strings.Contains(result.Failed[0].Reason, "invalid role") {
		t.Fatalf("expected 'invalid role' reason, got: %s", result.Failed[0].Reason)
	}
}

// ---------------------------------------------------------------------------
// 14.5 — BulkRemoveMembers with last-lead protection
// ---------------------------------------------------------------------------

func TestBulkRemoveMembers_MultipleRemoved(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	user1 := uuid.New()
	user2 := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(2)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				uid := args[0].(uuid.UUID)
				return teamMembershipRow(uid, teamID, "member")
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("DELETE 1"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	result, err := svc.BulkRemoveMembers(context.Background(), teamID, []uuid.UUID{user1, user2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RemovedCount != 2 {
		t.Fatalf("expected removed_count=2, got %d", result.RemovedCount)
	}
}

func TestBulkRemoveMembers_NonMembersSkipped(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	user1 := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(1)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return &mockRow{err: pgx.ErrNoRows}
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	result, err := svc.BulkRemoveMembers(context.Background(), teamID, []uuid.UUID{user1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RemovedCount != 0 {
		t.Fatalf("expected removed_count=0, got %d", result.RemovedCount)
	}
	if len(result.Skipped) != 1 {
		t.Fatalf("expected 1 skipped, got %d", len(result.Skipped))
	}
}

func TestBulkRemoveMembers_RemovingAllLeadsRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	leadUser := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(1)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(leadUser, teamID, "lead")
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	_, err := svc.BulkRemoveMembers(context.Background(), teamID, []uuid.UUID{leadUser})
	if err == nil {
		t.Fatal("expected removal of all leads to be rejected")
	}
	if !strings.Contains(err.Error(), "zero leads") {
		t.Fatalf("expected 'zero leads' error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 14.6 — ChangeRole last-lead protection
// ---------------------------------------------------------------------------

func TestChangeRole_LeadToMemberAllowedWhenOtherLeadsExist(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	userID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(userID, teamID, "lead")
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(2)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
	}

	svc := newTeamSvcWithDB(db)
	err := svc.ChangeRole(context.Background(), teamID, userID, "member")
	if err != nil {
		t.Fatalf("expected role change to succeed when other leads exist, got: %v", err)
	}
}

func TestChangeRole_LastLeadToMemberRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	userID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM team_memberships WHERE user_id"):
				return teamMembershipRow(userID, teamID, "lead")
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "role = 'lead'"):
				return countRow(1)
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	err := svc.ChangeRole(context.Background(), teamID, userID, "member")
	if err == nil {
		t.Fatal("expected last lead demotion to be rejected")
	}
	if !strings.Contains(err.Error(), "last lead") {
		t.Fatalf("expected 'last lead' error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 14.7 — TransferTeam logic
// ---------------------------------------------------------------------------

func TestTransferTeam_ArchivedTeamRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	targetOrgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, true) // archived
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	_, err := svc.TransferTeam(context.Background(), orgID, teamID, targetOrgID)
	if err == nil {
		t.Fatal("expected transfer of archived team to be rejected")
	}
	if !strings.Contains(err.Error(), "archived") {
		t.Fatalf("expected 'archived' error, got: %v", err)
	}
}

func TestTransferTeam_TeamNotInSourceOrgRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	otherOrgID := uuid.New()
	targetOrgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, otherOrgID, false) // belongs to different org
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	_, err := svc.TransferTeam(context.Background(), orgID, teamID, targetOrgID)
	if err == nil {
		t.Fatal("expected transfer of team from wrong org to be rejected")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

func TestTransferTeam_TargetOrgNotFoundRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	targetOrgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM organizations WHERE id"):
				return &mockRow{err: pgx.ErrNoRows} // target org not found
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	_, err := svc.TransferTeam(context.Background(), orgID, teamID, targetOrgID)
	if err == nil {
		t.Fatal("expected transfer to non-existent org to be rejected")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected 'not found' error, got: %v", err)
	}
}

func TestTransferTeam_TargetOrgAtLimitRejected(t *testing.T) {
	teamID := uuid.New()
	orgID := uuid.New()
	targetOrgID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "FROM teams WHERE id"):
				return teamRow(teamID, orgID, false)
			case strings.Contains(sql, "FROM organizations WHERE id"):
				return teamOrgRow(targetOrgID, 5) // max 5 teams
			case strings.Contains(sql, "COUNT(*)") && strings.Contains(sql, "FROM teams WHERE org_id"):
				return countRow(5) // already at limit
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	svc := newTeamSvcWithDB(db)
	_, err := svc.TransferTeam(context.Background(), orgID, teamID, targetOrgID)
	if err == nil {
		t.Fatal("expected transfer to full org to be rejected")
	}
	if !strings.Contains(err.Error(), "team limit") {
		t.Fatalf("expected 'team limit' error, got: %v", err)
	}
}
