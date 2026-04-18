package service

import (
	"fmt"
	"testing"

	"pgregory.net/rapid"
)

// Feature: enhanced-api-keys, Property 1: Scope Validation via Provider
// Validates: Requirements 1.3
//
// Scope validation now uses a dynamic provider. These tests verify the
// isValidScope method works correctly with a configured provider.
func TestProperty_ScopeValidationViaProvider(t *testing.T) {
	knownScopes := []string{
		"team.inboxes.view", "team.inboxes.create", "team.emails.view",
		"team.webhooks.view", "team.webhooks.manage",
		"team.apikeys.view", "team.apikeys.manage",
		"team.domains.view", "team.domains.manage",
	}

	scopeSet := make(map[string]bool, len(knownScopes))
	for _, s := range knownScopes {
		scopeSet[s] = true
	}

	svc := NewAPIKeyService(nil, WithScopesProvider(func() []string {
		return knownScopes
	}))

	// Sub-test: all known valid scopes are accepted
	t.Run("valid_scopes_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			scope := rapid.SampledFrom(knownScopes).Draw(t, "scope")
			if !svc.isValidScope(scope) {
				t.Fatalf("expected scope %q to be valid, got false", scope)
			}
		})
	})

	// Sub-test: random strings that are NOT in the known set return false
	t.Run("invalid_scopes_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			s := rapid.String().Draw(t, "randomString")
			// Skip if the random string happens to be a valid scope
			if scopeSet[s] {
				return
			}
			if svc.isValidScope(s) {
				t.Fatalf("expected scope %q to be invalid, got true", s)
			}
		})
	})

	// Sub-test: without a provider, all scopes are rejected
	t.Run("no_provider_rejects_all", func(t *testing.T) {
		svcNoProvider := NewAPIKeyService(nil)
		rapid.Check(t, func(t *rapid.T) {
			scope := rapid.SampledFrom(knownScopes).Draw(t, "scope")
			if svcNoProvider.isValidScope(scope) {
				t.Fatalf("expected scope %q to be rejected without provider, got true", scope)
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 4: Scope Validation on Mutation
// Validates: Requirements 4.3, 4.4
//
// For any set of scope strings provided during create or update,
// if all scopes are recognized by the provider the operation succeeds.
// If any scope is not recognized, the operation fails with an error
// identifying the invalid scope.
func TestProperty_ScopeValidationOnMutation(t *testing.T) {
	knownScopes := []string{
		"team.inboxes.view", "team.inboxes.create", "team.emails.view",
		"team.webhooks.view", "team.webhooks.manage",
		"team.apikeys.view", "team.apikeys.manage",
		"team.domains.view", "team.domains.manage",
	}

	scopeSet := make(map[string]bool, len(knownScopes))
	for _, s := range knownScopes {
		scopeSet[s] = true
	}

	svc := NewAPIKeyService(nil, WithScopesProvider(func() []string {
		return knownScopes
	}))

	// validateScopesLocal mirrors the inline validation logic used in Generate and Update.
	validateScopesLocal := func(scopes []string) error {
		for _, sc := range scopes {
			if !svc.isValidScope(sc) {
				return fmt.Errorf("invalid scope: %s", sc)
			}
		}
		return nil
	}

	// Helper: returns true if every element in the slice is a valid scope.
	allValid := func(scopes []string) bool {
		for _, sc := range scopes {
			if !scopeSet[sc] {
				return false
			}
		}
		return true
	}

	// Helper: returns the first invalid scope in the slice, or "" if all valid.
	firstInvalid := func(scopes []string) string {
		for _, sc := range scopes {
			if !scopeSet[sc] {
				return sc
			}
		}
		return ""
	}

	// Generator for a non-empty array of only valid scopes (1-9 scopes, sampled from known set).
	validScopeArrayGen := func(t *rapid.T) []string {
		n := rapid.IntRange(1, 9).Draw(t, "numScopes")
		scopes := make([]string, n)
		for i := 0; i < n; i++ {
			scopes[i] = rapid.SampledFrom(knownScopes).Draw(t, fmt.Sprintf("scope_%d", i))
		}
		return scopes
	}

	// Generator for a random string that is NOT a valid scope.
	invalidScopeGen := func(t *rapid.T) string {
		for {
			s := rapid.StringMatching(`[a-z:_]{1,30}`).Draw(t, "invalidScope")
			if !scopeSet[s] {
				return s
			}
		}
	}

	// Generator for a mixed array that contains at least one invalid scope.
	mixedScopeArrayGen := func(t *rapid.T) []string {
		// Start with 0-5 valid scopes
		numValid := rapid.IntRange(0, 5).Draw(t, "numValid")
		// Add 1-3 invalid scopes
		numInvalid := rapid.IntRange(1, 3).Draw(t, "numInvalid")

		scopes := make([]string, 0, numValid+numInvalid)
		for i := 0; i < numValid; i++ {
			scopes = append(scopes, rapid.SampledFrom(knownScopes).Draw(t, fmt.Sprintf("validScope_%d", i)))
		}
		for i := 0; i < numInvalid; i++ {
			scopes = append(scopes, invalidScopeGen(t))
		}

		// Shuffle to randomize position of invalid scopes
		shuffled := rapid.Permutation(scopes).Draw(t, "shuffled")
		return shuffled
	}

	t.Run("all_valid_scopes_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			scopes := validScopeArrayGen(t)
			err := validateScopesLocal(scopes)
			if err != nil {
				t.Fatalf("expected all-valid scopes %v to be accepted, got error: %v", scopes, err)
			}
		})
	})

	t.Run("any_invalid_scope_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			scopes := mixedScopeArrayGen(t)
			err := validateScopesLocal(scopes)
			if err == nil {
				t.Fatalf("expected scopes %v with invalid entries to be rejected, but got nil error", scopes)
			}
			// Verify the error identifies an invalid scope
			inv := firstInvalid(scopes)
			expected := fmt.Sprintf("invalid scope: %s", inv)
			if err.Error() != expected {
				t.Fatalf("expected error %q, got %q", expected, err.Error())
			}
		})
	})

	t.Run("validation_consistent_with_allValid_predicate", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Generate a random mix: sometimes all valid, sometimes mixed
			useValid := rapid.Bool().Draw(t, "useAllValid")
			var scopes []string
			if useValid {
				scopes = validScopeArrayGen(t)
			} else {
				scopes = mixedScopeArrayGen(t)
			}

			err := validateScopesLocal(scopes)
			isAllValid := allValid(scopes)

			if isAllValid && err != nil {
				t.Fatalf("all scopes valid but got error: %v (scopes: %v)", err, scopes)
			}
			if !isAllValid && err == nil {
				t.Fatalf("invalid scopes present but no error (scopes: %v)", scopes)
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 12: IP and CIDR Validation
// Validates: Requirements 11.2, 11.5
//
// For any string that is a valid IPv4 address, IPv6 address, or CIDR notation,
// ValidateIPs SHALL accept it. For any string that is not a valid IP or CIDR,
// ValidateIPs SHALL reject it with an error identifying the invalid entry.
func TestProperty_IPAndCIDRValidation(t *testing.T) {
	// Generator for valid IPv4 addresses (e.g. "192.168.1.1")
	ipv4Gen := func(t *rapid.T) string {
		a := rapid.IntRange(0, 255).Draw(t, "a")
		b := rapid.IntRange(0, 255).Draw(t, "b")
		c := rapid.IntRange(0, 255).Draw(t, "c")
		d := rapid.IntRange(0, 255).Draw(t, "d")
		return fmt.Sprintf("%d.%d.%d.%d", a, b, c, d)
	}

	// Generator for valid IPv6 addresses (full form, e.g. "2001:0db8:...")
	ipv6Gen := func(t *rapid.T) string {
		groups := make([]string, 8)
		for i := 0; i < 8; i++ {
			v := rapid.IntRange(0, 0xFFFF).Draw(t, fmt.Sprintf("g%d", i))
			groups[i] = fmt.Sprintf("%x", v)
		}
		return fmt.Sprintf("%s:%s:%s:%s:%s:%s:%s:%s",
			groups[0], groups[1], groups[2], groups[3],
			groups[4], groups[5], groups[6], groups[7])
	}

	// Generator for valid IPv4 CIDR (e.g. "10.0.0.0/8")
	cidrV4Gen := func(t *rapid.T) string {
		ip := ipv4Gen(t)
		prefix := rapid.IntRange(0, 32).Draw(t, "prefix")
		return fmt.Sprintf("%s/%d", ip, prefix)
	}

	// Generator for valid IPv6 CIDR (e.g. "2001:db8::/32")
	cidrV6Gen := func(t *rapid.T) string {
		ip := ipv6Gen(t)
		prefix := rapid.IntRange(0, 128).Draw(t, "prefix")
		return fmt.Sprintf("%s/%d", ip, prefix)
	}

	// Generator for invalid IP/CIDR strings
	invalidIPGen := func(t *rapid.T) string {
		kind := rapid.IntRange(0, 5).Draw(t, "invalidKind")
		switch kind {
		case 0:
			// Octet out of range
			a := rapid.IntRange(256, 999).Draw(t, "badOctet")
			return fmt.Sprintf("%d.0.0.1", a)
		case 1:
			// Random word
			return rapid.StringMatching(`[a-z]{3,10}`).Draw(t, "word")
		case 2:
			// Too many octets
			return "1.2.3.4.5"
		case 3:
			// CIDR with bad prefix length
			return "10.0.0.0/33"
		case 4:
			// Empty string
			return ""
		default:
			// Partial IP
			return "192.168"
		}
	}

	t.Run("valid_ipv4_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			ip := ipv4Gen(t)
			err := ValidateIPs([]string{ip})
			if err != nil {
				t.Fatalf("expected valid IPv4 %q to be accepted, got error: %v", ip, err)
			}
		})
	})

	t.Run("valid_ipv6_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			ip := ipv6Gen(t)
			err := ValidateIPs([]string{ip})
			if err != nil {
				t.Fatalf("expected valid IPv6 %q to be accepted, got error: %v", ip, err)
			}
		})
	})

	t.Run("valid_cidr_v4_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			cidr := cidrV4Gen(t)
			err := ValidateIPs([]string{cidr})
			if err != nil {
				t.Fatalf("expected valid CIDR %q to be accepted, got error: %v", cidr, err)
			}
		})
	})

	t.Run("valid_cidr_v6_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			cidr := cidrV6Gen(t)
			err := ValidateIPs([]string{cidr})
			if err != nil {
				t.Fatalf("expected valid IPv6 CIDR %q to be accepted, got error: %v", cidr, err)
			}
		})
	})

	t.Run("invalid_strings_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			invalid := invalidIPGen(t)
			err := ValidateIPs([]string{invalid})
			if err == nil {
				t.Fatalf("expected invalid string %q to be rejected, but got nil error", invalid)
			}
			expected := fmt.Sprintf("invalid IP/CIDR: %s", invalid)
			if err.Error() != expected {
				t.Fatalf("expected error %q, got %q", expected, err.Error())
			}
		})
	})

	t.Run("mixed_valid_and_invalid_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Build a list with some valid entries and one invalid entry
			numValid := rapid.IntRange(0, 5).Draw(t, "numValid")
			entries := make([]string, 0, numValid+1)
			for i := 0; i < numValid; i++ {
				kind := rapid.IntRange(0, 3).Draw(t, fmt.Sprintf("validKind_%d", i))
				switch kind {
				case 0:
					entries = append(entries, ipv4Gen(t))
				case 1:
					entries = append(entries, ipv6Gen(t))
				case 2:
					entries = append(entries, cidrV4Gen(t))
				default:
					entries = append(entries, cidrV6Gen(t))
				}
			}
			// Append one invalid entry at the end
			invalid := invalidIPGen(t)
			entries = append(entries, invalid)

			err := ValidateIPs(entries)
			if err == nil {
				t.Fatalf("expected list with invalid entry %q to be rejected, but got nil error", invalid)
			}
		})
	})

	t.Run("all_valid_mixed_types_accepted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			n := rapid.IntRange(1, 10).Draw(t, "numEntries")
			entries := make([]string, n)
			for i := 0; i < n; i++ {
				kind := rapid.IntRange(0, 3).Draw(t, fmt.Sprintf("kind_%d", i))
				switch kind {
				case 0:
					entries[i] = ipv4Gen(t)
				case 1:
					entries[i] = ipv6Gen(t)
				case 2:
					entries[i] = cidrV4Gen(t)
				default:
					entries[i] = cidrV6Gen(t)
				}
			}
			err := ValidateIPs(entries)
			if err != nil {
				t.Fatalf("expected all-valid list %v to be accepted, got error: %v", entries, err)
			}
		})
	})

	t.Run("empty_list_accepted", func(t *testing.T) {
		err := ValidateIPs([]string{})
		if err != nil {
			t.Fatalf("expected empty list to be accepted, got error: %v", err)
		}
	})
}
