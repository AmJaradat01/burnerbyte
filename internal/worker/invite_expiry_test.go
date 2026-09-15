package worker

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"pgregory.net/rapid"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: auth-lifecycle-management — Invite expiry worker property tests.
// ===========================================================================

// ---------------------------------------------------------------------------
// Minimal database.DBTX mock (Exec / Query / QueryRow) plus row adapters.
// ---------------------------------------------------------------------------

type stubDB struct {
	queryFn    func(sql string, args ...any) (pgx.Rows, error)
	queryRowFn func(sql string, args ...any) pgx.Row
	execFn     func(sql string, args ...any) (pgconn.CommandTag, error)
}

func (s *stubDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if s.execFn != nil {
		return s.execFn(sql, args...)
	}
	return pgconn.NewCommandTag("OK"), nil
}

func (s *stubDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return s.queryFn(sql, args...)
}

func (s *stubDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return s.queryRowFn(sql, args...)
}

// stubRow / stubRows decode pre-built value slices into scan destinations,
// covering the column types the invite and user queries use.
type stubRow struct {
	values []any
	err    error
}

func (r *stubRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return fmt.Errorf("stubRow: expected %d dest, got %d", len(r.values), len(dest))
	}
	for i, v := range r.values {
		switch d := dest[i].(type) {
		case *uuid.UUID:
			*d = v.(uuid.UUID)
		case **uuid.UUID:
			if up, ok := v.(*uuid.UUID); ok {
				*d = up
			} else {
				*d = nil
			}
		case *string:
			*d = v.(string)
		case **string:
			if sp, ok := v.(*string); ok {
				*d = sp
			} else {
				*d = nil
			}
		case *bool:
			*d = v.(bool)
		case *time.Time:
			*d = v.(time.Time)
		case **time.Time:
			if tp, ok := v.(*time.Time); ok {
				*d = tp
			} else {
				*d = nil
			}
		case **int:
			if ip, ok := v.(*int); ok {
				*d = ip
			} else {
				*d = nil
			}
		case *[]byte:
			if b, ok := v.([]byte); ok {
				*d = b
			} else {
				*d = nil
			}
		case *any:
			*d = v
		default:
			return fmt.Errorf("stubRow: unsupported dest type %T at index %d", dest[i], i)
		}
	}
	return nil
}

type stubRows struct {
	rows [][]any
	idx  int
}

func (m *stubRows) Close()                                       {}
func (m *stubRows) Err() error                                   { return nil }
func (m *stubRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (m *stubRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *stubRows) RawValues() [][]byte                          { return nil }
func (m *stubRows) Conn() *pgx.Conn                              { return nil }
func (m *stubRows) Values() ([]any, error)                       { return m.rows[m.idx-1], nil }

func (m *stubRows) Next() bool {
	if m.idx >= len(m.rows) {
		return false
	}
	m.idx++
	return true
}

func (m *stubRows) Scan(dest ...any) error {
	return (&stubRow{values: m.rows[m.idx-1]}).Scan(dest...)
}

// userRow builds a stubRow matching UserRepo.scanOne's 17-column SELECT.
func userRow(id uuid.UUID, email string) *stubRow {
	now := time.Now()
	hash := "hash"
	var nilStr *string
	var nilTime *time.Time
	var nilInt *int
	return &stubRow{values: []any{
		id, email, "Inviter", nilStr, &hash,
		nilStr, nilStr, false, true, nilTime,
		nilStr, nilStr, nilStr, nilStr, nilInt, now, now,
	}}
}

// ---------------------------------------------------------------------------
// Fake email sender — records every attempt and can be told to fail per address.
// ---------------------------------------------------------------------------

type fakeSender struct {
	attempts []string        // recipients, in order, including failed sends
	failFor  map[string]bool // recipients whose Send should fail
}

func (f *fakeSender) Send(to, subject, templateName string, data any) error {
	f.attempts = append(f.attempts, to)
	if f.failFor[to] {
		return errors.New("simulated smtp failure")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Test scenario builder
// ---------------------------------------------------------------------------

type expiryScenario struct {
	db             *stubDB
	inviterEmails  map[string]bool // emails that are inviters (valid recipients)
	inviteeEmails  map[string]bool // emails that are invitees (must never be mailed)
	withInviter    int             // count of invites that have an inviter
	deleteExecuted *bool
}

// buildScenario constructs invite rows and wires a stubDB so FindExpiringInvites
// returns them, GetByID resolves inviters by id, and DeleteExpiredInvites is
// observable. hasInviter[i] controls whether invite i carries an inviter.
func buildScenario(hasInviter []bool) expiryScenario {
	now := time.Now()
	inviterEmails := map[string]bool{}
	inviteeEmails := map[string]bool{}
	inviterByID := map[uuid.UUID]string{}
	var inviteRows [][]any
	withInviter := 0

	for i, has := range hasInviter {
		inviteeEmail := fmt.Sprintf("invitee%d@corp.com", i)
		inviteeEmails[inviteeEmail] = true

		var invitedBy *uuid.UUID
		if has {
			id := uuid.New()
			email := fmt.Sprintf("inviter%d@corp.com", i)
			inviterByID[id] = email
			inviterEmails[email] = true
			invitedBy = &id
			withInviter++
		}

		inviteRows = append(inviteRows, []any{
			uuid.New(),         // id
			uuid.New(),         // org_id
			(*uuid.UUID)(nil),  // team_id
			inviteeEmail,       // email
			"member",           // org_role
			(*string)(nil),     // team_role
			invitedBy,          // invited_by
			now.Add(time.Hour), // expires_at (within the 24h window)
			now,                // created_at
			([]byte)(nil),      // allowed_auth
		})
	}

	deleteExecuted := false
	db := &stubDB{
		queryFn: func(sql string, args ...any) (pgx.Rows, error) {
			// FindExpiringInvites
			return &stubRows{rows: inviteRows}, nil
		},
		queryRowFn: func(sql string, args ...any) pgx.Row {
			// GetByID(inviter)
			if id, ok := args[0].(uuid.UUID); ok {
				if email, found := inviterByID[id]; found {
					return userRow(id, email)
				}
			}
			return &stubRow{err: pgx.ErrNoRows}
		},
		execFn: func(sql string, args ...any) (pgconn.CommandTag, error) {
			deleteExecuted = true // DeleteExpiredInvites
			return pgconn.NewCommandTag("DELETE 0"), nil
		},
	}

	return expiryScenario{
		db:             db,
		inviterEmails:  inviterEmails,
		inviteeEmails:  inviteeEmails,
		withInviter:    withInviter,
		deleteExecuted: &deleteExecuted,
	}
}

// Property 5: Expiry notifications are bounded.
//
// For any set of pending expiring invites, the worker sends at most one email
// per invite (one per invite that has an inviter), sends only to inviters
// (never to invitees), and skips invites with no inviter.
//
// Validates: Requirements 4.1, 4.2, 4.3
func TestProperty_InviteExpiry_Bounded(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		n := rapid.IntRange(0, 8).Draw(rt, "numInvites")
		hasInviter := make([]bool, n)
		for i := range hasInviter {
			hasInviter[i] = rapid.Bool().Draw(rt, fmt.Sprintf("hasInviter_%d", i))
		}

		sc := buildScenario(hasInviter)
		sender := &fakeSender{}
		job := InviteExpiryJob(postgres.NewOrgRepo(sc.db), postgres.NewUserRepo(sc.db), sender, "https://app.test")

		if err := job(context.Background()); err != nil {
			rt.Fatalf("worker returned error: %v", err)
		}

		// Exactly one email per invite that has an inviter (skips the rest).
		if len(sender.attempts) != sc.withInviter {
			rt.Fatalf("expected %d emails (one per invite with an inviter), got %d", sc.withInviter, len(sender.attempts))
		}
		// Every recipient is an inviter; none is an invitee.
		for _, to := range sender.attempts {
			if !sc.inviterEmails[to] {
				rt.Fatalf("email sent to %q which is not an inviter", to)
			}
			if sc.inviteeEmails[to] {
				rt.Fatalf("email was sent to invitee %q (must only notify inviters)", to)
			}
		}
	})
}

// Property 6: Expiry worker error resilience.
//
// For any sequence of expiring invites where some email sends fail, the worker
// keeps processing the remaining invites (attempts a send for every invite with
// an inviter), still reaches the cleanup phase, and returns nil.
//
// Validates: Requirement 4.4
func TestProperty_InviteExpiry_ResilientToSendFailures(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		n := rapid.IntRange(1, 8).Draw(rt, "numInvites")
		hasInviter := make([]bool, n)
		shouldFail := make([]bool, n)
		for i := range hasInviter {
			hasInviter[i] = rapid.Bool().Draw(rt, fmt.Sprintf("hasInviter_%d", i))
			shouldFail[i] = rapid.Bool().Draw(rt, fmt.Sprintf("shouldFail_%d", i))
		}

		sc := buildScenario(hasInviter)

		// Fail sends for a subset of inviter addresses.
		failFor := map[string]bool{}
		i := 0
		for email := range sc.inviterEmails {
			if i < len(shouldFail) && shouldFail[i] {
				failFor[email] = true
			}
			i++
		}
		sender := &fakeSender{failFor: failFor}
		job := InviteExpiryJob(postgres.NewOrgRepo(sc.db), postgres.NewUserRepo(sc.db), sender, "https://app.test")

		// Must not abort even when some sends fail.
		if err := job(context.Background()); err != nil {
			rt.Fatalf("worker aborted on send failure: %v", err)
		}
		// Every invite with an inviter was still attempted.
		if len(sender.attempts) != sc.withInviter {
			rt.Fatalf("expected %d send attempts despite failures, got %d", sc.withInviter, len(sender.attempts))
		}
		// Cleanup phase still ran.
		if !*sc.deleteExecuted {
			rt.Fatal("expected the cleanup phase (DeleteExpiredInvites) to run after sends")
		}
	})
}
