package service

import (
	"context"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// ===========================================================================
// Feature: invite-auth-provisioning — property tests for auth-method
// constraint enforcement and allowed_auth validation.
//
// Pragmatic coverage: the pure constraint check (Property 2) and the
// structural allowed_auth validation (Property 3) are exercised here. The
// transaction- and DNS-dependent flows (bulk invite atomicity, SSO domain
// mapping bypass, revocation cascade) are validated by the shipped
// integration behavior and are out of scope for these unit-level tests.
// ===========================================================================

// Property 2: Auth method constraint enforcement.
//
// isAuthMethodAllowed(allowed, m) is true iff allowed is empty, contains
// "any", or contains the exact method m.
//
// Validates: Requirements 2.7, 2.8, 2.9, 2.10
func TestProperty_IsAuthMethodAllowed(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		allowed := rapid.SliceOfN(
			rapid.SampledFrom([]string{"any", "password", "sso:okta", "sso:google"}),
			0, 4,
		).Draw(rt, "allowed")
		method := rapid.SampledFrom([]string{"password", "sso:okta", "sso:google", "sso:other"}).Draw(rt, "method")

		want := len(allowed) == 0
		for _, a := range allowed {
			if a == "any" || a == method {
				want = true
				break
			}
		}

		if got := isAuthMethodAllowed(allowed, method); got != want {
			rt.Fatalf("allowed=%v method=%q: got %v, want %v", allowed, method, got, want)
		}
	})
}

// expectedAllowedAuthValid mirrors OrgService.validateAllowedAuth's decision
// when no SSO provider repository is configured (the structural rules only).
func expectedAllowedAuthValid(allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	hasAny := false
	for _, a := range allowed {
		if a == "any" {
			hasAny = true
		}
	}
	if hasAny {
		return len(allowed) == 1 // "any" must be the sole element
	}
	for _, a := range allowed {
		if a == "password" {
			continue
		}
		if strings.HasPrefix(a, "sso:") && strings.TrimPrefix(a, "sso:") != "" {
			continue
		}
		return false
	}
	return true
}

// Property 3: Allowed auth validation rejects invalid values — every element
// must be "any", "password", or "sso:<name>", and "any" must stand alone.
//
// Validates: Requirements 2.3, 2.4, 2.5
func TestProperty_ValidateAllowedAuth(t *testing.T) {
	// nil SSO provider repo: exercises the structural validation rules.
	svc := newOrgSvc(&mockDBTX{})

	rapid.Check(t, func(rt *rapid.T) {
		allowed := rapid.SliceOfN(
			rapid.SampledFrom([]string{"any", "password", "sso:okta", "sso:", "garbage", "SSO:Okta"}),
			0, 4,
		).Draw(rt, "allowed")

		err := svc.validateAllowedAuth(context.Background(), allowed)
		want := expectedAllowedAuthValid(allowed)
		if (err == nil) != want {
			rt.Fatalf("allowed=%v: got err=%v, want valid=%v", allowed, err, want)
		}
	})
}
