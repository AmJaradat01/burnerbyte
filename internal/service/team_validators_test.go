package service

import (
	"fmt"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// ===========================================================================
// Feature: enhanced-teams — unit/property tests for the pure team-settings
// validators (tasks 14.1, 14.2).
// ===========================================================================

// validateMaxInboxesPerDomain accepts a value iff it is strictly positive.
func TestProperty_ValidateMaxInboxesPerDomain(t *testing.T) {
	svc := &TeamService{}
	rapid.Check(t, func(rt *rapid.T) {
		n := rapid.IntRange(-1000, 1000).Draw(rt, "n")
		err := svc.validateMaxInboxesPerDomain(n)
		if (err == nil) != (n > 0) {
			rt.Fatalf("validateMaxInboxesPerDomain(%d): got err=%v, want ok=%v", n, err, n > 0)
		}
	})
}

// validateDefaultInboxTTL accepts ttl iff it parses as a Go duration and, when
// maxTTL is a valid duration, does not exceed it.
func TestProperty_ValidateDefaultInboxTTL(t *testing.T) {
	svc := &TeamService{}
	rapid.Check(t, func(rt *rapid.T) {
		ttl := rapid.OneOf(
			rapid.StringMatching(`[0-9]{1,4}(ns|us|ms|s|m|h)`),
			rapid.StringMatching(`[a-z0-9]{0,6}`),
		).Draw(rt, "ttl")
		// maxTTL is either empty (no ceiling) or a valid ms duration.
		maxTTL := ""
		if rapid.Bool().Draw(rt, "hasMax") {
			maxTTL = fmt.Sprintf("%dms", rapid.IntRange(0, 1_000_000).Draw(rt, "maxMs"))
		}

		want := true
		d, err := time.ParseDuration(ttl)
		if err != nil {
			want = false
		} else if maxTTL != "" {
			if maxD, mErr := time.ParseDuration(maxTTL); mErr == nil && d > maxD {
				want = false
			}
		}

		got := svc.validateDefaultInboxTTL(ttl, maxTTL)
		if (got == nil) != want {
			rt.Fatalf("validateDefaultInboxTTL(%q, %q): got err=%v, want ok=%v", ttl, maxTTL, got, want)
		}
	})
}
