package audit

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

func TestGetSeverity(t *testing.T) {
	cases := map[string]string{
		"admin.platform_settings_updated": "critical",
		"org.deleted":                     "critical",
		"user.locked":                     "critical",
		"member.removed":                  "warning",
		"inbox.deleted":                   "warning",
		"user.forgot_password":            "info",
		// Not in the map -> default "info". inbox.created and inbox.expired are
		// intentionally unclassified-as-info, unlike inbox.deleted (warning).
		"inbox.created":          "info",
		"inbox.expired":          "info",
		"totally.unknown.action": "info",
	}
	for action, want := range cases {
		if got := GetSeverity(action); got != want {
			t.Errorf("GetSeverity(%q) = %q, want %q", action, got, want)
		}
	}
}

func TestGetCategory(t *testing.T) {
	cases := map[string]string{
		"user.login":      "auth",
		"org.created":     "org",
		"member.invited":  "member",
		"team.created":    "team",
		"domain.created":  "domain",
		"inbox.created":   "inbox",
		"inbox.expired":   "inbox", // classified alongside the other inbox events
		"email.received":  "email",
		"webhook.created": "webhook",
		"apikey.created":  "apikey",
		// Not in the map -> default empty string.
		"totally.unknown.action": "",
	}
	for action, want := range cases {
		if got := GetCategory(action); got != want {
			t.Errorf("GetCategory(%q) = %q, want %q", action, got, want)
		}
	}
}

// ===========================================================================
// Feature: enhanced-audit-logging — property tests.
// ===========================================================================

// Property 1: Severity classification is complete and correct — every mapped
// action returns its mapped severity, every unmapped action returns "info",
// and the result is always one of info/warning/critical.
//
// Validates: Requirements 1.4, 12.1, 12.2, 12.3
func TestProperty_GetSeverity(t *testing.T) {
	validSeverity := map[string]bool{"info": true, "warning": true, "critical": true}

	// Completeness: every value in the map is a valid severity.
	keys := make([]string, 0, len(SeverityMap))
	for action, sev := range SeverityMap {
		if !validSeverity[sev] {
			t.Fatalf("SeverityMap[%q] = %q is not a valid severity", action, sev)
		}
		keys = append(keys, action)
	}

	rapid.Check(t, func(rt *rapid.T) {
		action := rapid.OneOf(
			rapid.SampledFrom(keys),
			rapid.StringMatching(`[a-z]{1,12}\.[a-z_]{1,16}`),
		).Draw(rt, "action")

		want, ok := SeverityMap[action]
		if !ok {
			want = "info"
		}

		got := GetSeverity(action)
		if got != want {
			rt.Fatalf("GetSeverity(%q) = %q, want %q", action, got, want)
		}
		if !validSeverity[got] {
			rt.Fatalf("GetSeverity(%q) = %q is not a valid severity", action, got)
		}
	})
}

// Property 2: Category classification is complete and correct — every mapped
// action returns exactly its mapped (non-empty) category, and every unmapped
// action returns "".
//
// Validates: Requirements 1.5, 13.1-13.10
func TestProperty_GetCategory(t *testing.T) {
	keys := make([]string, 0, len(CategoryMap))
	for action, cat := range CategoryMap {
		if cat == "" {
			t.Fatalf("CategoryMap[%q] maps to the empty category", action)
		}
		keys = append(keys, action)
	}

	rapid.Check(t, func(rt *rapid.T) {
		action := rapid.OneOf(
			rapid.SampledFrom(keys),
			rapid.StringMatching(`[a-z]{1,12}\.[a-z_]{1,16}`),
		).Draw(rt, "action")

		want, ok := CategoryMap[action]
		if !ok {
			want = ""
		}
		if got := GetCategory(action); got != want {
			rt.Fatalf("GetCategory(%q) = %q, want %q", action, got, want)
		}
	})
}

// Property 3: AuditEntry JSON serialization round-trips — marshaling an entry
// and unmarshaling it back preserves every field.
//
// Validates: Requirements 2.3
func TestProperty_AuditEntryJSONRoundTrip(t *testing.T) {
	text := rapid.StringMatching(`[ -~]{0,24}`) // printable ASCII round-trips cleanly through JSON

	rapid.Check(t, func(rt *rapid.T) {
		entry := domain.AuditEntry{
			ID:               uuid.New(),
			OrgID:            uuid.New(),
			Action:           text.Draw(rt, "action"),
			ResourceType:     text.Draw(rt, "resourceType"),
			ResourceID:       uuid.New(),
			ResourceName:     text.Draw(rt, "resourceName"),
			ActorEmail:       text.Draw(rt, "actorEmail"),
			ActorDisplayName: text.Draw(rt, "actorDisplayName"),
			UserAgent:        text.Draw(rt, "userAgent"),
			Severity:         rapid.SampledFrom([]string{"", "info", "warning", "critical"}).Draw(rt, "severity"),
			Category:         rapid.SampledFrom([]string{"", "auth", "admin", "team"}).Draw(rt, "category"),
			Metadata:         map[string]any{"k": text.Draw(rt, "metaValue")},
			CreatedAt:        time.Unix(rapid.Int64Range(0, 2_000_000_000).Draw(rt, "ts"), 0).UTC(),
		}
		if rapid.Bool().Draw(rt, "hasActor") {
			a := uuid.New()
			entry.ActorID = &a
		}
		if rapid.Bool().Draw(rt, "hasIP") {
			ip := rapid.SampledFrom([]string{"1.2.3.4", "::1", "203.0.113.7"}).Draw(rt, "ip")
			entry.IPAddress = &ip
		}

		b, err := json.Marshal(entry)
		if err != nil {
			rt.Fatalf("marshal: %v", err)
		}
		var got domain.AuditEntry
		if err := json.Unmarshal(b, &got); err != nil {
			rt.Fatalf("unmarshal: %v", err)
		}

		if got.ID != entry.ID || got.OrgID != entry.OrgID || got.ResourceID != entry.ResourceID {
			rt.Fatalf("uuid fields not preserved: %+v vs %+v", got, entry)
		}
		if got.Action != entry.Action || got.ResourceType != entry.ResourceType ||
			got.ResourceName != entry.ResourceName || got.ActorEmail != entry.ActorEmail ||
			got.ActorDisplayName != entry.ActorDisplayName || got.UserAgent != entry.UserAgent ||
			got.Severity != entry.Severity || got.Category != entry.Category {
			rt.Fatalf("string fields not preserved:\n got=%+v\nwant=%+v", got, entry)
		}
		if !got.CreatedAt.Equal(entry.CreatedAt) {
			rt.Fatalf("CreatedAt not preserved: got %v want %v", got.CreatedAt, entry.CreatedAt)
		}
		if (got.ActorID == nil) != (entry.ActorID == nil) ||
			(got.ActorID != nil && *got.ActorID != *entry.ActorID) {
			rt.Fatalf("ActorID not preserved: got %v want %v", got.ActorID, entry.ActorID)
		}
		if (got.IPAddress == nil) != (entry.IPAddress == nil) ||
			(got.IPAddress != nil && *got.IPAddress != *entry.IPAddress) {
			rt.Fatalf("IPAddress not preserved: got %v want %v", got.IPAddress, entry.IPAddress)
		}
		gotMeta, _ := got.Metadata.(map[string]any)
		wantMeta := entry.Metadata.(map[string]any)
		if gotMeta == nil || gotMeta["k"] != wantMeta["k"] {
			rt.Fatalf("Metadata not preserved: got %v want %v", got.Metadata, entry.Metadata)
		}
	})
}

func TestStripPort(t *testing.T) {
	cases := map[string]string{
		"1.2.3.4:5678":    "1.2.3.4",
		"203.0.113.7:443": "203.0.113.7",
		"[::1]:8080":      "::1",
		// No port -> returned unchanged.
		"1.2.3.4": "1.2.3.4",
		"":        "",
	}
	for in, want := range cases {
		if got := stripPort(in); got != want {
			t.Errorf("stripPort(%q) = %q, want %q", in, got, want)
		}
	}
}
