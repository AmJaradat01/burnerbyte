package service

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: invite-team-assignment — InviteMember validates that an assigned
// team belongs to the inviting org (the core of the shipped fix). These
// rejection paths return before any transaction, so the mock harness suffices.
// DNS resolution is stubbed via the package lookupMX/lookupHost seam.
// ===========================================================================

// bypassDNS makes the invite email-domain DNS check always succeed for tests.
func bypassDNS(t *testing.T) {
	t.Helper()
	origMX, origHost := lookupMX, lookupHost
	lookupMX = func(string) ([]*net.MX, error) { return []*net.MX{{Host: "mx.test.", Pref: 10}}, nil }
	lookupHost = func(string) ([]string, error) { return []string{"203.0.113.10"}, nil }
	t.Cleanup(func() { lookupMX, lookupHost = origMX, origHost })
}

// teamGetByIDRow matches TeamRepo.GetByID's 11-column SELECT.
func teamGetByIDRow(id, orgID uuid.UUID) *mockRow {
	now := time.Now()
	var nilStr *string
	var nilTime *time.Time
	settings, _ := json.Marshal(domain.TeamSettings{})
	return &mockRow{values: []any{
		id, orgID, "Team", "team", nilStr, nilStr, false, nilTime, settings, now, now,
	}}
}

func newOrgSvcWithTeam(db *mockDBTX) *OrgService {
	return NewOrgService(nil, postgres.NewOrgRepo(db), postgres.NewTeamRepo(db), nil, nil, nil, "", 0)
}

func teamInviteInput(teamID uuid.UUID, teamRole *string) domain.InviteMemberInput {
	tid := teamID.String()
	return domain.InviteMemberInput{
		Email:    "newuser@corp.com",
		OrgRole:  "member",
		TeamID:   &tid,
		TeamRole: teamRole,
	}
}

func TestInviteMember_RejectsTeamFromAnotherOrg(t *testing.T) {
	bypassDNS(t)
	orgID, teamID, otherOrg := uuid.New(), uuid.New(), uuid.New()
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM teams WHERE id") {
				return teamGetByIDRow(teamID, otherOrg) // belongs to a different org
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	_, err := newOrgSvcWithTeam(db).InviteMember(context.Background(), orgID, teamInviteInput(teamID, nil), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "does not belong to this organization") {
		t.Fatalf("expected team-org mismatch rejection, got: %v", err)
	}
}

func TestInviteMember_RejectsUnknownTeam(t *testing.T) {
	bypassDNS(t)
	orgID, teamID := uuid.New(), uuid.New()
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			return &mockRow{err: pgx.ErrNoRows} // team not found
		},
	}
	_, err := newOrgSvcWithTeam(db).InviteMember(context.Background(), orgID, teamInviteInput(teamID, nil), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "team not found") {
		t.Fatalf("expected team-not-found rejection, got: %v", err)
	}
}

func TestInviteMember_RejectsInvalidTeamRole(t *testing.T) {
	bypassDNS(t)
	orgID, teamID := uuid.New(), uuid.New()
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM teams WHERE id") {
				return teamGetByIDRow(teamID, orgID) // same org → passes org check
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	bad := "supervisor"
	_, err := newOrgSvcWithTeam(db).InviteMember(context.Background(), orgID, teamInviteInput(teamID, &bad), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "invalid team_role") {
		t.Fatalf("expected invalid team_role rejection, got: %v", err)
	}
}
