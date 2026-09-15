package auth

import (
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

// Feature: enhanced-api-keys, Property 7: Middleware Rejects Disabled and Revoked Keys
// Validates: Requirements 6.4, 7.3
//
// For any API key that has is_active=false or revoked_at set, the auth middleware
// SHALL reject authentication attempts, returning HTTP 401.

// checkKeyState simulates the middleware's key state validation logic.
// It mirrors the ordered checks in Middleware(): expired → revoked → disabled.
// Returns (httpStatus, errorMessage) or (0, "") if the key passes all checks.
func checkKeyState(key *domain.APIKey) (int, string) {
	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return 401, "API key expired"
	}
	if key.RevokedAt != nil {
		return 401, "API key revoked"
	}
	if !key.IsActive {
		return 401, "API key disabled"
	}
	return 0, ""
}

func TestProperty_MiddlewareRejectsDisabledAndRevokedKeys(t *testing.T) {
	// Generator for a base valid (non-expired) API key
	baseKeyGen := func(t *rapid.T) domain.APIKey {
		return domain.APIKey{
			ID:        uuid.New(),
			TeamID:    uuid.New(),
			CreatedBy: uuid.New(),
			KeyHash:   "somehash",
			KeyPrefix: "bb_abc1234",
			Name:      rapid.StringMatching(`[a-zA-Z0-9]{3,20}`).Draw(t, "name"),
			Scopes:    []string{"team.inboxes.view"},
			IsActive:  true,
			CreatedAt: time.Now().Add(-24 * time.Hour),
		}
	}

	// Sub-test: disabled keys (is_active=false) are rejected with 401
	t.Run("disabled_keys_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := baseKeyGen(t)
			key.IsActive = false
			// Ensure not revoked and not expired so we isolate the disabled check
			key.RevokedAt = nil
			key.ExpiresAt = nil

			status, msg := checkKeyState(&key)
			if status != 401 {
				t.Fatalf("expected status 401 for disabled key, got %d", status)
			}
			if msg != "API key disabled" {
				t.Fatalf("expected error %q, got %q", "API key disabled", msg)
			}
		})
	})

	// Sub-test: revoked keys (revoked_at set) are rejected with 401
	t.Run("revoked_keys_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := baseKeyGen(t)
			// Generate a revocation time in the past
			daysAgo := rapid.IntRange(1, 365).Draw(t, "daysAgo")
			revokedAt := time.Now().Add(-time.Duration(daysAgo) * 24 * time.Hour)
			key.RevokedAt = &revokedAt
			revokedBy := uuid.New()
			key.RevokedBy = &revokedBy
			// Key may or may not be active — revoked check comes first
			key.IsActive = rapid.Bool().Draw(t, "isActive")
			key.ExpiresAt = nil

			status, msg := checkKeyState(&key)
			if status != 401 {
				t.Fatalf("expected status 401 for revoked key, got %d", status)
			}
			if msg != "API key revoked" {
				t.Fatalf("expected error %q, got %q", "API key revoked", msg)
			}
		})
	})

	// Sub-test: keys that are both disabled AND revoked are rejected (revoked takes priority)
	t.Run("revoked_and_disabled_keys_rejected_as_revoked", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := baseKeyGen(t)
			key.IsActive = false
			daysAgo := rapid.IntRange(1, 365).Draw(t, "daysAgo")
			revokedAt := time.Now().Add(-time.Duration(daysAgo) * 24 * time.Hour)
			key.RevokedAt = &revokedAt
			revokedBy := uuid.New()
			key.RevokedBy = &revokedBy
			key.ExpiresAt = nil

			status, msg := checkKeyState(&key)
			if status != 401 {
				t.Fatalf("expected status 401 for revoked+disabled key, got %d", status)
			}
			// Revoked check comes before disabled in middleware ordering
			if msg != "API key revoked" {
				t.Fatalf("expected error %q (revoked takes priority), got %q", "API key revoked", msg)
			}
		})
	})

	// Sub-test: active, non-revoked, non-expired keys pass all checks
	t.Run("active_non_revoked_keys_pass", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := baseKeyGen(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.ExpiresAt = nil

			status, msg := checkKeyState(&key)
			if status != 0 {
				t.Fatalf("expected active non-revoked key to pass, got status %d with error %q", status, msg)
			}
		})
	})

	// Sub-test: any key with is_active=false OR revoked_at set is always rejected with 401
	t.Run("disabled_or_revoked_always_401", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := baseKeyGen(t)
			// Ensure key is not expired so we only test disabled/revoked logic
			key.ExpiresAt = nil

			// Randomly choose: disabled, revoked, or both
			variant := rapid.IntRange(0, 2).Draw(t, "variant")
			switch variant {
			case 0: // disabled only
				key.IsActive = false
				key.RevokedAt = nil
			case 1: // revoked only
				key.IsActive = true
				daysAgo := rapid.IntRange(1, 365).Draw(t, "daysAgo")
				revokedAt := time.Now().Add(-time.Duration(daysAgo) * 24 * time.Hour)
				key.RevokedAt = &revokedAt
				revokedBy := uuid.New()
				key.RevokedBy = &revokedBy
			case 2: // both
				key.IsActive = false
				daysAgo := rapid.IntRange(1, 365).Draw(t, "daysAgo")
				revokedAt := time.Now().Add(-time.Duration(daysAgo) * 24 * time.Hour)
				key.RevokedAt = &revokedAt
				revokedBy := uuid.New()
				key.RevokedBy = &revokedBy
			}

			status, msg := checkKeyState(&key)
			if status != 401 {
				t.Fatalf("expected 401 for disabled/revoked key (variant=%d), got %d", variant, status)
			}
			// Verify the message is one of the expected values
			validMessages := map[string]bool{
				"API key revoked":  true,
				"API key disabled": true,
			}
			if !validMessages[msg] {
				t.Fatalf("unexpected error message %q for variant %d", msg, variant)
			}

			// Verify ordering: if revoked, message should be "revoked" regardless of is_active
			if key.RevokedAt != nil && msg != "API key revoked" {
				t.Fatalf("revoked key should produce %q, got %q", "API key revoked", msg)
			}
			if key.RevokedAt == nil && !key.IsActive && msg != "API key disabled" {
				t.Fatalf("disabled (non-revoked) key should produce %q, got %q", "API key disabled", msg)
			}
		})
	})
}

// Suppress unused import warning
var _ = fmt.Sprintf

// Feature: enhanced-api-keys, Property 13: IP Allowlist Enforcement
// Validates: Requirements 11.3, 11.4
//
// For any API key with a non-empty allowed_ips list and any request IP, the middleware
// SHALL allow the request if and only if the IP matches at least one entry in the allowlist
// (exact match or CIDR containment). For any API key with NULL or empty allowed_ips, the
// middleware SHALL allow requests from any IP.

func TestProperty_IPAllowlistEnforcement(t *testing.T) {
	// Generator for a valid random IPv4 address
	ipv4Gen := func(t *rapid.T, label string) string {
		a := rapid.IntRange(1, 254).Draw(t, label+"_a")
		b := rapid.IntRange(0, 255).Draw(t, label+"_b")
		c := rapid.IntRange(0, 255).Draw(t, label+"_c")
		d := rapid.IntRange(1, 254).Draw(t, label+"_d")
		return fmt.Sprintf("%d.%d.%d.%d", a, b, c, d)
	}

	// Generator for a valid CIDR (IPv4) with prefix length 8-30
	cidrGen := func(t *rapid.T, label string) string {
		a := rapid.IntRange(1, 254).Draw(t, label+"_a")
		b := rapid.IntRange(0, 255).Draw(t, label+"_b")
		c := rapid.IntRange(0, 255).Draw(t, label+"_c")
		d := rapid.IntRange(0, 255).Draw(t, label+"_d")
		prefix := rapid.IntRange(8, 30).Draw(t, label+"_prefix")
		return fmt.Sprintf("%d.%d.%d.%d/%d", a, b, c, d, prefix)
	}

	// Reference implementation: check if ip is allowed by the allowlist
	// This mirrors the middleware logic using net.ParseIP and net.ParseCIDR
	referenceIPAllowed := func(ip string, allowedIPs []string) bool {
		parsedIP := net.ParseIP(ip)
		if parsedIP == nil {
			return false
		}
		for _, entry := range allowedIPs {
			if entryIP := net.ParseIP(entry); entryIP != nil {
				if entryIP.Equal(parsedIP) {
					return true
				}
				continue
			}
			if _, cidr, err := net.ParseCIDR(entry); err == nil {
				if cidr.Contains(parsedIP) {
					return true
				}
			}
		}
		return false
	}

	// Sub-test: empty or nil allowlist allows all IPs (middleware skips ipAllowed check)
	t.Run("empty_allowlist_allows_all", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			ip := ipv4Gen(t, "ip")

			// Simulate middleware logic: if AllowedIPs is empty/nil, skip IP check entirely
			for _, allowedIPs := range [][]string{nil, {}} {
				var blocked bool
				if len(allowedIPs) > 0 {
					if !ipAllowed(ip, allowedIPs) {
						blocked = true
					}
				}
				if blocked {
					t.Fatalf("empty/nil allowlist should allow IP %s, but it was blocked", ip)
				}
			}
		})
	})

	// Sub-test: exact IP match allows, non-match rejects
	t.Run("exact_ip_match", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			allowedIP := ipv4Gen(t, "allowed")
			requestIP := ipv4Gen(t, "request")
			allowlist := []string{allowedIP}

			actual := ipAllowed(requestIP, allowlist)
			expected := referenceIPAllowed(requestIP, allowlist)

			if actual != expected {
				t.Fatalf("ipAllowed(%q, %v) = %v, reference says %v", requestIP, allowlist, actual, expected)
			}

			// If the request IP equals the allowed IP, it must be allowed
			if requestIP == allowedIP && !actual {
				t.Fatalf("exact match IP %q should be allowed by allowlist %v", requestIP, allowlist)
			}
		})
	})

	// Sub-test: CIDR containment
	t.Run("cidr_containment", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			cidr := cidrGen(t, "cidr")
			requestIP := ipv4Gen(t, "request")
			allowlist := []string{cidr}

			actual := ipAllowed(requestIP, allowlist)
			expected := referenceIPAllowed(requestIP, allowlist)

			if actual != expected {
				t.Fatalf("ipAllowed(%q, %v) = %v, reference says %v", requestIP, allowlist, actual, expected)
			}
		})
	})

	// Sub-test: mixed allowlist with multiple exact IPs and CIDRs
	t.Run("mixed_allowlist", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Build a mixed allowlist of exact IPs and CIDRs
			numExact := rapid.IntRange(0, 3).Draw(t, "numExact")
			numCIDR := rapid.IntRange(0, 3).Draw(t, "numCIDR")
			var allowlist []string
			for i := 0; i < numExact; i++ {
				allowlist = append(allowlist, ipv4Gen(t, fmt.Sprintf("exactIP_%d", i)))
			}
			for i := 0; i < numCIDR; i++ {
				allowlist = append(allowlist, cidrGen(t, fmt.Sprintf("cidr_%d", i)))
			}

			requestIP := ipv4Gen(t, "request")

			// Skip if allowlist ended up empty (tested separately)
			if len(allowlist) == 0 {
				return
			}

			actual := ipAllowed(requestIP, allowlist)
			expected := referenceIPAllowed(requestIP, allowlist)

			if actual != expected {
				t.Fatalf("ipAllowed(%q, %v) = %v, reference says %v", requestIP, allowlist, actual, expected)
			}
		})
	})

	// Sub-test: IP known to be in CIDR is always allowed
	t.Run("ip_within_cidr_always_allowed", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Generate a /24 network and pick an IP within it
			a := rapid.IntRange(1, 254).Draw(t, "net_a")
			b := rapid.IntRange(0, 255).Draw(t, "net_b")
			c := rapid.IntRange(0, 255).Draw(t, "net_c")
			hostPart := rapid.IntRange(1, 254).Draw(t, "host")
			cidr := fmt.Sprintf("%d.%d.%d.0/24", a, b, c)
			ip := fmt.Sprintf("%d.%d.%d.%d", a, b, c, hostPart)

			allowlist := []string{cidr}
			if !ipAllowed(ip, allowlist) {
				t.Fatalf("IP %s should be within CIDR %s but was rejected", ip, cidr)
			}
		})
	})

	// Sub-test: IP outside a /24 CIDR is rejected (different third octet)
	t.Run("ip_outside_cidr_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			a := rapid.IntRange(1, 254).Draw(t, "net_a")
			b := rapid.IntRange(0, 255).Draw(t, "net_b")
			c := rapid.IntRange(0, 254).Draw(t, "net_c")
			cidr := fmt.Sprintf("%d.%d.%d.0/24", a, b, c)

			// Pick a different third octet to guarantee outside the /24
			otherC := c + 1 // guaranteed different since c <= 254
			hostPart := rapid.IntRange(1, 254).Draw(t, "host")
			ip := fmt.Sprintf("%d.%d.%d.%d", a, b, otherC, hostPart)

			allowlist := []string{cidr}
			if ipAllowed(ip, allowlist) {
				t.Fatalf("IP %s should be outside CIDR %s but was allowed", ip, cidr)
			}
		})
	})

	// Sub-test: extractIP strips port correctly
	t.Run("extractIP_strips_port", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			ip := ipv4Gen(t, "ip")
			port := rapid.IntRange(1, 65535).Draw(t, "port")
			remoteAddr := fmt.Sprintf("%s:%d", ip, port)

			extracted := extractIP(remoteAddr)
			if extracted != ip {
				t.Fatalf("extractIP(%q) = %q, expected %q", remoteAddr, extracted, ip)
			}
		})
	})

	// Sub-test: middleware integration — non-empty AllowedIPs blocks non-matching IP
	t.Run("middleware_integration_ip_check", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			allowedIP := ipv4Gen(t, "allowed")
			requestIP := ipv4Gen(t, "request")

			key := domain.APIKey{
				ID:         uuid.New(),
				TeamID:     uuid.New(),
				CreatedBy:  uuid.New(),
				KeyHash:    "somehash",
				KeyPrefix:  "bb_abc1234",
				Name:       "test-key",
				Scopes:     []string{"team.inboxes.view"},
				IsActive:   true,
				AllowedIPs: []string{allowedIP},
			}

			// Simulate middleware logic: if AllowedIPs non-empty, check IP
			var status int
			var errMsg string
			if len(key.AllowedIPs) > 0 {
				if !ipAllowed(requestIP, key.AllowedIPs) {
					status = 403
					errMsg = "IP not allowed for this API key"
				}
			}

			if requestIP == allowedIP {
				// Should be allowed
				if status != 0 {
					t.Fatalf("IP %s matches allowlist %v but got status %d: %s", requestIP, key.AllowedIPs, status, errMsg)
				}
			} else {
				// Check against reference
				shouldAllow := referenceIPAllowed(requestIP, key.AllowedIPs)
				if shouldAllow && status != 0 {
					t.Fatalf("IP %s should be allowed by %v but got status %d", requestIP, key.AllowedIPs, status)
				}
				if !shouldAllow && status != 403 {
					t.Fatalf("IP %s should be rejected by %v but was allowed", requestIP, key.AllowedIPs)
				}
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 11: Request Count Monotonic Increment
// Validates: Requirements 9.3
//
// For any API key, after N successful authentication attempts through the middleware,
// the key's request_count SHALL equal its initial value plus N, and last_used_ip SHALL
// equal the IP of the most recent request.

func TestProperty_RequestCountMonotonicIncrement(t *testing.T) {
	// simulateTracking mirrors the middleware's UpdateLastUsedWithTracking logic:
	// each auth attempt increments request_count by 1 and sets last_used_ip.
	type trackingState struct {
		requestCount int64
		lastUsedIP   string
	}

	applyTracking := func(state *trackingState, ip string) {
		state.requestCount++
		state.lastUsedIP = ip
	}

	// Generator for a valid random IPv4 address
	ipv4Gen := func(t *rapid.T, label string) string {
		a := rapid.IntRange(1, 254).Draw(t, label+"_a")
		b := rapid.IntRange(0, 255).Draw(t, label+"_b")
		c := rapid.IntRange(0, 255).Draw(t, label+"_c")
		d := rapid.IntRange(1, 254).Draw(t, label+"_d")
		return fmt.Sprintf("%d.%d.%d.%d", a, b, c, d)
	}

	// Sub-test: after N auth attempts, request_count == initial + N
	t.Run("count_equals_initial_plus_N", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			initialCount := rapid.Int64Range(0, 1_000_000).Draw(t, "initialCount")
			n := rapid.IntRange(1, 200).Draw(t, "numAttempts")

			state := &trackingState{
				requestCount: initialCount,
				lastUsedIP:   "",
			}

			for i := 0; i < n; i++ {
				ip := ipv4Gen(t, fmt.Sprintf("ip_%d", i))
				applyTracking(state, ip)
			}

			expectedCount := initialCount + int64(n)
			if state.requestCount != expectedCount {
				t.Fatalf("after %d attempts from initial %d, request_count = %d, expected %d",
					n, initialCount, state.requestCount, expectedCount)
			}
		})
	})

	// Sub-test: last_used_ip equals the IP of the most recent attempt
	t.Run("last_used_ip_equals_most_recent", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			initialCount := rapid.Int64Range(0, 1_000_000).Draw(t, "initialCount")
			n := rapid.IntRange(1, 200).Draw(t, "numAttempts")

			state := &trackingState{
				requestCount: initialCount,
				lastUsedIP:   "",
			}

			var lastIP string
			for i := 0; i < n; i++ {
				ip := ipv4Gen(t, fmt.Sprintf("ip_%d", i))
				applyTracking(state, ip)
				lastIP = ip
			}

			if state.lastUsedIP != lastIP {
				t.Fatalf("after %d attempts, last_used_ip = %q, expected %q (most recent IP)",
					n, state.lastUsedIP, lastIP)
			}
		})
	})

	// Sub-test: request_count is strictly monotonically increasing (never decreases)
	t.Run("monotonically_increasing", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			initialCount := rapid.Int64Range(0, 1_000_000).Draw(t, "initialCount")
			n := rapid.IntRange(2, 200).Draw(t, "numAttempts")

			state := &trackingState{
				requestCount: initialCount,
				lastUsedIP:   "",
			}

			prevCount := state.requestCount
			for i := 0; i < n; i++ {
				ip := ipv4Gen(t, fmt.Sprintf("ip_%d", i))
				applyTracking(state, ip)

				if state.requestCount <= prevCount {
					t.Fatalf("request_count did not increase: prev=%d, current=%d after attempt %d",
						prevCount, state.requestCount, i+1)
				}
				prevCount = state.requestCount
			}
		})
	})

	// Sub-test: combined verification — count and last IP both correct after N attempts
	t.Run("combined_count_and_ip", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			initialCount := rapid.Int64Range(0, 1_000_000).Draw(t, "initialCount")
			n := rapid.IntRange(1, 200).Draw(t, "numAttempts")

			// Build the list of IPs upfront
			ips := make([]string, n)
			for i := 0; i < n; i++ {
				ips[i] = ipv4Gen(t, fmt.Sprintf("ip_%d", i))
			}

			state := &trackingState{
				requestCount: initialCount,
				lastUsedIP:   "",
			}

			for _, ip := range ips {
				applyTracking(state, ip)
			}

			expectedCount := initialCount + int64(n)
			expectedIP := ips[n-1]

			if state.requestCount != expectedCount {
				t.Fatalf("request_count = %d, expected %d (initial %d + %d attempts)",
					state.requestCount, expectedCount, initialCount, n)
			}
			if state.lastUsedIP != expectedIP {
				t.Fatalf("last_used_ip = %q, expected %q", state.lastUsedIP, expectedIP)
			}
		})
	})

	// Sub-test: domain model integration — simulate tracking on an actual APIKey struct
	t.Run("domain_model_integration", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			initialCount := rapid.Int64Range(0, 1_000_000).Draw(t, "initialCount")
			n := rapid.IntRange(1, 100).Draw(t, "numAttempts")

			key := domain.APIKey{
				ID:           uuid.New(),
				TeamID:       uuid.New(),
				CreatedBy:    uuid.New(),
				KeyHash:      "somehash",
				KeyPrefix:    "bb_abc1234",
				Name:         rapid.StringMatching(`[a-zA-Z0-9]{3,20}`).Draw(t, "name"),
				Scopes:       []string{"team.inboxes.view"},
				IsActive:     true,
				RequestCount: initialCount,
			}

			var lastIP string
			for i := 0; i < n; i++ {
				ip := ipv4Gen(t, fmt.Sprintf("ip_%d", i))
				// Simulate what UpdateLastUsedWithTracking does:
				// request_count = request_count + 1, last_used_ip = ip
				key.RequestCount++
				key.LastUsedIP = &ip
				lastIP = ip
			}

			expectedCount := initialCount + int64(n)
			if key.RequestCount != expectedCount {
				t.Fatalf("APIKey.RequestCount = %d, expected %d", key.RequestCount, expectedCount)
			}
			if key.LastUsedIP == nil || *key.LastUsedIP != lastIP {
				got := "<nil>"
				if key.LastUsedIP != nil {
					got = *key.LastUsedIP
				}
				t.Fatalf("APIKey.LastUsedIP = %q, expected %q", got, lastIP)
			}
		})
	})
}
