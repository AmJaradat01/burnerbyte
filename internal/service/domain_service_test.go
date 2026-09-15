package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"pgregory.net/rapid"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/domain"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// ===========================================================================
// Feature: enhanced-domains — property tests for status computation, domain
// update validation, and the settings cascade.
// ===========================================================================

// ---------------------------------------------------------------------------
// Row builders matching the repository scan signatures.
// ---------------------------------------------------------------------------

// domainGetByIDRow matches DomainRepo.GetByID's 14-column SELECT (id, org_id,
// domain_name, description, mx/txt/spf_verified, dns_last_checked_at, settings,
// created_at, updated_at, inboxes_created_count, active_inboxes, team_count).
func domainGetByIDRow(id, orgID uuid.UUID, settings domain.DomainSettings) *mockRow {
	now := time.Now()
	sb, _ := json.Marshal(settings)
	var nilStr *string
	var nilTime *time.Time
	return &mockRow{values: []any{
		id, orgID, "example.com", nilStr, false, false, false,
		nilTime, sb, now, now, 0, 0, 0,
	}}
}

// assignmentRow matches DomainAssignmentRepo.GetByID's 9-column SELECT.
func assignmentRow(id, domainID uuid.UUID) *mockRow {
	now := time.Now()
	var nilUUID *uuid.UUID
	return &mockRow{values: []any{
		id, uuid.New(), domainID, "read_write", []byte("{}"), nilUUID, now, now, "example.com",
	}}
}

// orgRow matches OrgRepo.GetByID's 7-column SELECT.
func orgRow(id uuid.UUID, settings domain.OrgSettings) *mockRow {
	now := time.Now()
	sb, _ := json.Marshal(settings)
	var nilStr *string
	return &mockRow{values: []any{
		id, "Org", "org-slug", nilStr, sb, now, now,
	}}
}

// updateDomainHarness builds a DomainService whose GetByID returns a domain
// owned by orgID with empty settings, and records whether Update is persisted.
func updateDomainHarness(orgID, domainID uuid.UUID) (*DomainService, *bool) {
	updateCalled := false
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM domains d WHERE d.id") {
				return domainGetByIDRow(domainID, orgID, domain.DomainSettings{})
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "UPDATE domains") {
				updateCalled = true
			}
			return pgconn.NewCommandTag("OK"), nil
		},
	}
	svc := NewDomainService(postgres.NewDomainRepo(db), nil, nil, nil, nil, &config.Config{})
	return svc, &updateCalled
}

// Property 1: Domain status computation is deterministic and correct, and
// independent of spf_verified.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 9.6
func TestProperty_ComputeStatus(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		mx := rapid.Bool().Draw(rt, "mx")
		txt := rapid.Bool().Draw(rt, "txt")
		spf := rapid.Bool().Draw(rt, "spf")
		checked := rapid.Bool().Draw(rt, "checked")

		d := &domain.Domain{MXVerified: mx, TXTVerified: txt, SPFVerified: spf}
		if checked {
			now := time.Now()
			d.DNSLastCheckedAt = &now
		}

		var want string
		switch {
		case mx && txt:
			want = "verified"
		case !mx && !txt:
			if checked {
				want = "failed"
			} else {
				want = "pending_verification"
			}
		default:
			want = "partially_verified"
		}

		got := ComputeStatus(d)
		if got != want {
			rt.Fatalf("mx=%v txt=%v checked=%v: got %q, want %q", mx, txt, checked, got, want)
		}

		// spf_verified must not affect the result.
		flipped := &domain.Domain{MXVerified: mx, TXTVerified: txt, SPFVerified: !spf, DNSLastCheckedAt: d.DNSLastCheckedAt}
		if other := ComputeStatus(flipped); other != got {
			rt.Fatalf("spf_verified changed status (mx=%v txt=%v checked=%v): %q vs %q", mx, txt, checked, got, other)
		}
	})
}

// Property 8: Description length validation — strings > 1000 chars are
// rejected, strings <= 1000 chars are accepted.
//
// Validates: Requirements 4.5
func TestProperty_UpdateDomain_DescriptionLength(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		orgID, domainID := uuid.New(), uuid.New()
		n := rapid.IntRange(0, 1100).Draw(rt, "length")
		desc := strings.Repeat("a", n)

		svc, updateCalled := updateDomainHarness(orgID, domainID)
		_, err := svc.UpdateDomain(context.Background(), orgID, domainID, domain.UpdateDomainInput{Description: &desc})

		if n > 1000 {
			if err == nil {
				rt.Fatalf("length=%d: expected rejection", n)
			}
			if *updateCalled {
				rt.Fatalf("length=%d: rejected update must not persist", n)
			}
		} else {
			if err != nil {
				rt.Fatalf("length=%d: expected acceptance, got %v", n, err)
			}
			if !*updateCalled {
				rt.Fatalf("length=%d: accepted update must persist", n)
			}
		}
	})
}

// Property 5: Duration string validation matches Go's time.ParseDuration —
// the service accepts a TTL string iff time.ParseDuration succeeds.
//
// Validates: Requirements 2.4, 2.5
func TestProperty_UpdateDomain_DurationValidation(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		orgID, domainID := uuid.New(), uuid.New()
		// Mix mostly-valid duration strings with mostly-invalid arbitrary ones.
		s := rapid.OneOf(
			rapid.StringMatching(`[0-9]{1,4}(ns|us|ms|s|m|h)`),
			rapid.StringMatching(`[a-zA-Z0-9]{0,6}`),
		).Draw(rt, "ttl")
		_, perr := time.ParseDuration(s)
		valid := perr == nil

		svc, updateCalled := updateDomainHarness(orgID, domainID)
		_, err := svc.UpdateDomain(context.Background(), orgID, domainID, domain.UpdateDomainInput{
			Settings: &domain.DomainSettings{DefaultInboxTTL: &s},
		})

		if valid {
			if err != nil {
				rt.Fatalf("ttl=%q parses as a duration but was rejected: %v", s, err)
			}
			if !*updateCalled {
				rt.Fatalf("ttl=%q is valid but was not persisted", s)
			}
		} else {
			if err == nil {
				rt.Fatalf("ttl=%q is not a valid duration but was accepted", s)
			}
			if *updateCalled {
				rt.Fatalf("ttl=%q is invalid but was persisted", s)
			}
		}
	})
}

// Property 6: Default TTL cannot exceed max TTL — given two valid duration
// strings, validation fails iff parsed default > parsed max.
//
// Validates: Requirements 2.7
func TestProperty_UpdateDomain_DefaultNotExceedMax(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		orgID, domainID := uuid.New(), uuid.New()
		def := fmt.Sprintf("%dms", rapid.IntRange(0, 1_000_000).Draw(rt, "defaultMs"))
		max := fmt.Sprintf("%dms", rapid.IntRange(0, 1_000_000).Draw(rt, "maxMs"))
		dd, _ := time.ParseDuration(def)
		mm, _ := time.ParseDuration(max)

		svc, updateCalled := updateDomainHarness(orgID, domainID)
		_, err := svc.UpdateDomain(context.Background(), orgID, domainID, domain.UpdateDomainInput{
			Settings: &domain.DomainSettings{DefaultInboxTTL: &def, MaxInboxTTL: &max},
		})

		if dd > mm {
			if err == nil {
				rt.Fatalf("default %v > max %v but was accepted", dd, mm)
			}
			if *updateCalled {
				rt.Fatalf("default %v > max %v but was persisted", dd, mm)
			}
		} else {
			if err != nil {
				rt.Fatalf("default %v <= max %v but was rejected: %v", dd, mm, err)
			}
			if !*updateCalled {
				rt.Fatalf("default %v <= max %v but was not persisted", dd, mm)
			}
		}
	})
}

// Property 7: Settings cascade returns the first non-nil value in priority
// order (domain → org → system default).
//
// Validates: Requirements 2.8, 2.9, 2.10
func TestProperty_SettingsCascade_MaxInboxesPerDomain(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		assignmentID, domainID, orgID := uuid.New(), uuid.New(), uuid.New()
		def := rapid.IntRange(1, 100).Draw(rt, "systemDefault")

		var domainVal *int
		if rapid.Bool().Draw(rt, "hasDomainVal") {
			v := rapid.IntRange(101, 200).Draw(rt, "domainVal")
			domainVal = &v
		}
		var orgVal *int
		if rapid.Bool().Draw(rt, "hasOrgVal") {
			v := rapid.IntRange(201, 300).Draw(rt, "orgVal")
			orgVal = &v
		}

		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				// Order matters: the domain GetByID query references
				// domain_assignments in a COUNT subquery, so match the
				// assignment query by its distinctive JOIN first.
				switch {
				case strings.Contains(sql, "domain_assignments da JOIN"):
					return assignmentRow(assignmentID, domainID)
				case strings.Contains(sql, "FROM domains d WHERE d.id"):
					return domainGetByIDRow(domainID, orgID, domain.DomainSettings{MaxInboxesPerDomain: domainVal})
				case strings.Contains(sql, "FROM organizations"):
					return orgRow(orgID, domain.OrgSettings{MaxInboxesPerDomain: orgVal})
				}
				return &mockRow{err: pgx.ErrNoRows}
			},
		}

		resolver := NewSettingsResolver(
			postgres.NewDomainAssignmentRepo(db),
			postgres.NewDomainRepo(db),
			postgres.NewOrgRepo(db),
			config.DefaultsConfig{MaxInboxesPerDomain: def},
		)

		got := resolver.ResolveMaxInboxesPerDomain(context.Background(), assignmentID)

		want := def
		if orgVal != nil {
			want = *orgVal
		}
		if domainVal != nil {
			want = *domainVal
		}

		if got != want {
			rt.Fatalf("cascade mismatch: domainVal=%v orgVal=%v default=%d → got %d, want %d",
				domainVal, orgVal, def, got, want)
		}
	})
}
