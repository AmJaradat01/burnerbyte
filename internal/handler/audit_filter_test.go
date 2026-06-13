package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"pgregory.net/rapid"
)

// ===========================================================================
// Feature: enhanced-audit-logging, Property 9 — invalid filter values are
// rejected by parseAuditFilter.
// ===========================================================================

// Property 9: any severity that is not info/warning/critical is rejected, and
// any category not in the defined set is rejected; valid values are accepted.
//
// Validates: Requirements 14.4, 14.5
func TestProperty_AuditFilter_RejectsInvalidValues(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		sev := rapid.OneOf(
			rapid.SampledFrom([]string{"info", "warning", "critical"}),
			rapid.StringMatching(`[a-z]{1,10}`),
		).Draw(rt, "severity")
		cat := rapid.OneOf(
			rapid.SampledFrom([]string{"auth", "org", "team", "domain", "inbox", "email", "webhook", "apikey", "admin", "member"}),
			rapid.StringMatching(`[a-z]{1,10}`),
		).Draw(rt, "category")

		q := url.Values{}
		q.Set("severity", sev)
		q.Set("category", cat)
		req := httptest.NewRequest(http.MethodGet, "/?"+q.Encode(), nil)
		w := httptest.NewRecorder()

		_, ok := parseAuditFilter(w, req)

		want := validSeverities[sev] && validCategories[cat]
		if ok != want {
			rt.Fatalf("severity=%q category=%q: parse ok=%v, want %v", sev, cat, ok, want)
		}
		if !ok && w.Code != http.StatusBadRequest {
			rt.Fatalf("severity=%q category=%q: expected 400 on rejection, got %d", sev, cat, w.Code)
		}
	})
}
