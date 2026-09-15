package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// inviteRow builds the 12-column row GetInviteByToken scans (id, org_id,
// team_id, email, org_role, team_role, token, invited_by, accepted_at,
// expires_at, created_at, allowed_auth).
func inviteRow(email string, expiresAt time.Time, acceptedAt *time.Time) *mockRow {
	return &mockRow{values: []any{
		uuid.New(),  // id
		uuid.New(),  // org_id
		nil,         // team_id (*uuid)
		email,       // email
		"member",    // org_role
		nil,         // team_role (*string)
		"hash",      // token
		nil,         // invited_by (*uuid)
		acceptedAt,  // accepted_at (*time)
		expiresAt,   // expires_at
		time.Now(),  // created_at
		[]byte(nil), // allowed_auth
	}}
}

func newOrgSvc(db *mockDBTX) *OrgService {
	// pool is nil: the gates under test return before any transaction begins.
	return NewOrgService(nil, postgres.NewOrgRepo(db), nil, nil, nil, nil, "", 0)
}

// TestAcceptInvite_EmailMismatch is the core invite-takeover guard: an invite
// addressed to one email cannot be accepted by an account with a different one.
func TestAcceptInvite_EmailMismatch(t *testing.T) {
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM invites") {
				return inviteRow("alice@corp.com", time.Now().Add(time.Hour), nil)
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	_, err := newOrgSvc(db).AcceptInvite(context.Background(), "tok", uuid.New(), "attacker@evil.com")
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "email mismatch") {
		t.Fatalf("expected an email-mismatch rejection, got: %v", err)
	}
}

// TestAcceptInvite_Expired confirms an expired invite is rejected before any
// membership is granted.
func TestAcceptInvite_Expired(t *testing.T) {
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM invites") {
				return inviteRow("alice@corp.com", time.Now().Add(-time.Hour), nil) // already expired
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	_, err := newOrgSvc(db).AcceptInvite(context.Background(), "tok", uuid.New(), "alice@corp.com")
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected an 'invite expired' rejection, got: %v", err)
	}
}
