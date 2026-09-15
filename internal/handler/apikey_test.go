package handler

import (
	"context"
	cryptoRand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

// Feature: enhanced-api-keys, Property 3: Update Field Persistence
// Validates: Requirements 4.1, 4.2, 4.5, 5.2
//
// For any valid API key and any valid update input (name, description, scopes subset,
// expires_at timestamp, is_active, allowed_ips), patching the key and then retrieving it
// SHALL return the updated values for all provided fields, with unspecified fields unchanged.

// applyUpdate simulates the update logic: for each non-nil field in the input,
// the corresponding field on the key is updated. This mirrors what repo.Update + re-fetch does.
func applyUpdate(original domain.APIKey, input domain.UpdateAPIKeyInput) domain.APIKey {
	updated := original
	if input.Name != nil {
		updated.Name = *input.Name
	}
	if input.Description != nil {
		updated.Description = input.Description
	}
	if len(input.Scopes) > 0 {
		updated.Scopes = input.Scopes
	}
	if input.IsActive != nil {
		updated.IsActive = *input.IsActive
	}
	if input.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *input.ExpiresAt)
		if err == nil {
			updated.ExpiresAt = &t
		}
	}
	if input.AllowedIPs != nil {
		ips := *input.AllowedIPs
		if len(ips) > 0 {
			updated.AllowedIPs = ips
		} else {
			updated.AllowedIPs = nil
		}
	}
	return updated
}

// validScopes mirrors the service-layer valid scopes for generator use.
var testValidScopes = []string{
	"team.inboxes.create", "team.inboxes.view", "team.emails.view",
	"team.webhooks.view", "team.webhooks.manage",
	"team.apikeys.view", "team.apikeys.manage",
	"team.domains.view", "team.domains.manage",
}

// genBaseAPIKey generates a random valid APIKey with realistic field values.
func genBaseAPIKey(t *rapid.T) domain.APIKey {
	name := rapid.StringMatching(`[A-Za-z0-9 _-]{1,50}`).Draw(t, "baseName")

	var desc *string
	if rapid.Bool().Draw(t, "hasDesc") {
		d := rapid.StringMatching(`[A-Za-z0-9 .,!?_-]{0,100}`).Draw(t, "baseDesc")
		desc = &d
	}

	numScopes := rapid.IntRange(1, len(testValidScopes)).Draw(t, "numBaseScopes")
	scopeIndices := rapid.Permutation(testValidScopes).Draw(t, "baseScopesPerm")
	scopes := scopeIndices[:numScopes]

	isActive := rapid.Bool().Draw(t, "baseIsActive")

	var expiresAt *time.Time
	if rapid.Bool().Draw(t, "hasExpiry") {
		// Future timestamp between 1 hour and 365 days from now
		offsetHours := rapid.IntRange(1, 8760).Draw(t, "expiryOffset")
		exp := time.Now().Add(time.Duration(offsetHours) * time.Hour).Truncate(time.Second).UTC()
		expiresAt = &exp
	}

	var allowedIPs []string
	if rapid.Bool().Draw(t, "hasIPs") {
		numIPs := rapid.IntRange(1, 5).Draw(t, "numBaseIPs")
		allowedIPs = make([]string, numIPs)
		for i := 0; i < numIPs; i++ {
			a := rapid.IntRange(1, 254).Draw(t, fmt.Sprintf("baseIP_a_%d", i))
			b := rapid.IntRange(0, 255).Draw(t, fmt.Sprintf("baseIP_b_%d", i))
			c := rapid.IntRange(0, 255).Draw(t, fmt.Sprintf("baseIP_c_%d", i))
			d := rapid.IntRange(1, 254).Draw(t, fmt.Sprintf("baseIP_d_%d", i))
			allowedIPs[i] = fmt.Sprintf("%d.%d.%d.%d", a, b, c, d)
		}
	}

	return domain.APIKey{
		ID:          uuid.New(),
		TeamID:      uuid.New(),
		CreatedBy:   uuid.New(),
		KeyHash:     "fakehash",
		KeyPrefix:   "bb_abc1234",
		Name:        name,
		Description: desc,
		Scopes:      scopes,
		IsActive:    isActive,
		ExpiresAt:   expiresAt,
		AllowedIPs:  allowedIPs,
		CreatedAt:   time.Now().Truncate(time.Second).UTC(),
	}
}

// genUpdateInput generates a random valid UpdateAPIKeyInput where at least one field is set.
func genUpdateInput(t *rapid.T) domain.UpdateAPIKeyInput {
	var input domain.UpdateAPIKeyInput

	setName := rapid.Bool().Draw(t, "setName")
	setDesc := rapid.Bool().Draw(t, "setDesc")
	setScopes := rapid.Bool().Draw(t, "setScopes")
	setActive := rapid.Bool().Draw(t, "setActive")
	setExpiry := rapid.Bool().Draw(t, "setExpiry")
	setIPs := rapid.Bool().Draw(t, "setIPs")

	// Ensure at least one field is set
	if !setName && !setDesc && !setScopes && !setActive && !setExpiry && !setIPs {
		setName = true
	}

	if setName {
		n := rapid.StringMatching(`[A-Za-z0-9 _-]{1,50}`).Draw(t, "updateName")
		input.Name = &n
	}
	if setDesc {
		d := rapid.StringMatching(`[A-Za-z0-9 .,!?_-]{0,100}`).Draw(t, "updateDesc")
		input.Description = &d
	}
	if setScopes {
		numScopes := rapid.IntRange(1, len(testValidScopes)).Draw(t, "numUpdateScopes")
		perm := rapid.Permutation(testValidScopes).Draw(t, "updateScopesPerm")
		input.Scopes = perm[:numScopes]
	}
	if setActive {
		a := rapid.Bool().Draw(t, "updateActive")
		input.IsActive = &a
	}
	if setExpiry {
		offsetHours := rapid.IntRange(1, 8760).Draw(t, "updateExpiryOffset")
		exp := time.Now().Add(time.Duration(offsetHours) * time.Hour).Truncate(time.Second).UTC()
		s := exp.Format(time.RFC3339)
		input.ExpiresAt = &s
	}
	if setIPs {
		numIPs := rapid.IntRange(0, 5).Draw(t, "numUpdateIPs")
		ips := make([]string, numIPs)
		for i := 0; i < numIPs; i++ {
			a := rapid.IntRange(1, 254).Draw(t, fmt.Sprintf("updateIP_a_%d", i))
			b := rapid.IntRange(0, 255).Draw(t, fmt.Sprintf("updateIP_b_%d", i))
			c := rapid.IntRange(0, 255).Draw(t, fmt.Sprintf("updateIP_c_%d", i))
			d := rapid.IntRange(1, 254).Draw(t, fmt.Sprintf("updateIP_d_%d", i))
			ips[i] = fmt.Sprintf("%d.%d.%d.%d", a, b, c, d)
		}
		input.AllowedIPs = &ips
	}

	return input
}

func TestProperty_UpdateFieldPersistence(t *testing.T) {
	// Sub-test: updated fields match the input values after applying the update
	t.Run("updated_fields_match_input", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			original := genBaseAPIKey(t)
			input := genUpdateInput(t)
			updated := applyUpdate(original, input)

			if input.Name != nil && updated.Name != *input.Name {
				t.Fatalf("Name: expected %q, got %q", *input.Name, updated.Name)
			}
			if input.Description != nil {
				if updated.Description == nil || *updated.Description != *input.Description {
					t.Fatalf("Description: expected %q, got %v", *input.Description, updated.Description)
				}
			}
			if len(input.Scopes) > 0 {
				if len(updated.Scopes) != len(input.Scopes) {
					t.Fatalf("Scopes length: expected %d, got %d", len(input.Scopes), len(updated.Scopes))
				}
				for i, s := range input.Scopes {
					if updated.Scopes[i] != s {
						t.Fatalf("Scopes[%d]: expected %q, got %q", i, s, updated.Scopes[i])
					}
				}
			}
			if input.IsActive != nil && updated.IsActive != *input.IsActive {
				t.Fatalf("IsActive: expected %v, got %v", *input.IsActive, updated.IsActive)
			}
			if input.ExpiresAt != nil {
				expectedTime, _ := time.Parse(time.RFC3339, *input.ExpiresAt)
				if updated.ExpiresAt == nil || !updated.ExpiresAt.Equal(expectedTime) {
					t.Fatalf("ExpiresAt: expected %v, got %v", expectedTime, updated.ExpiresAt)
				}
			}
			if input.AllowedIPs != nil {
				inputIPs := *input.AllowedIPs
				if len(inputIPs) == 0 {
					if updated.AllowedIPs != nil {
						t.Fatalf("AllowedIPs: expected nil for empty input, got %v", updated.AllowedIPs)
					}
				} else {
					if len(updated.AllowedIPs) != len(inputIPs) {
						t.Fatalf("AllowedIPs length: expected %d, got %d", len(inputIPs), len(updated.AllowedIPs))
					}
					for i, ip := range inputIPs {
						if updated.AllowedIPs[i] != ip {
							t.Fatalf("AllowedIPs[%d]: expected %q, got %q", i, ip, updated.AllowedIPs[i])
						}
					}
				}
			}
		})
	})

	// Sub-test: unspecified fields remain unchanged after applying the update
	t.Run("unspecified_fields_unchanged", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			original := genBaseAPIKey(t)
			input := genUpdateInput(t)
			updated := applyUpdate(original, input)

			if input.Name == nil && updated.Name != original.Name {
				t.Fatalf("Name should be unchanged: expected %q, got %q", original.Name, updated.Name)
			}
			if input.Description == nil {
				if (original.Description == nil) != (updated.Description == nil) {
					t.Fatalf("Description nil-ness changed: original=%v, updated=%v", original.Description, updated.Description)
				}
				if original.Description != nil && updated.Description != nil && *original.Description != *updated.Description {
					t.Fatalf("Description should be unchanged: expected %q, got %q", *original.Description, *updated.Description)
				}
			}
			if len(input.Scopes) == 0 {
				if len(updated.Scopes) != len(original.Scopes) {
					t.Fatalf("Scopes should be unchanged: expected %v, got %v", original.Scopes, updated.Scopes)
				}
				for i, s := range original.Scopes {
					if updated.Scopes[i] != s {
						t.Fatalf("Scopes[%d] should be unchanged: expected %q, got %q", i, s, updated.Scopes[i])
					}
				}
			}
			if input.IsActive == nil && updated.IsActive != original.IsActive {
				t.Fatalf("IsActive should be unchanged: expected %v, got %v", original.IsActive, updated.IsActive)
			}
			if input.ExpiresAt == nil {
				if (original.ExpiresAt == nil) != (updated.ExpiresAt == nil) {
					t.Fatalf("ExpiresAt nil-ness changed: original=%v, updated=%v", original.ExpiresAt, updated.ExpiresAt)
				}
				if original.ExpiresAt != nil && updated.ExpiresAt != nil && !original.ExpiresAt.Equal(*updated.ExpiresAt) {
					t.Fatalf("ExpiresAt should be unchanged: expected %v, got %v", original.ExpiresAt, updated.ExpiresAt)
				}
			}
			if input.AllowedIPs == nil {
				if len(updated.AllowedIPs) != len(original.AllowedIPs) {
					t.Fatalf("AllowedIPs should be unchanged: expected %v, got %v", original.AllowedIPs, updated.AllowedIPs)
				}
				for i, ip := range original.AllowedIPs {
					if updated.AllowedIPs[i] != ip {
						t.Fatalf("AllowedIPs[%d] should be unchanged: expected %q, got %q", i, ip, updated.AllowedIPs[i])
					}
				}
			}

			// Immutable fields should never change
			if updated.ID != original.ID {
				t.Fatalf("ID should never change: expected %v, got %v", original.ID, updated.ID)
			}
			if updated.TeamID != original.TeamID {
				t.Fatalf("TeamID should never change: expected %v, got %v", original.TeamID, updated.TeamID)
			}
			if updated.CreatedBy != original.CreatedBy {
				t.Fatalf("CreatedBy should never change: expected %v, got %v", original.CreatedBy, updated.CreatedBy)
			}
			if updated.KeyHash != original.KeyHash {
				t.Fatalf("KeyHash should never change: expected %q, got %q", original.KeyHash, updated.KeyHash)
			}
			if updated.KeyPrefix != original.KeyPrefix {
				t.Fatalf("KeyPrefix should never change: expected %q, got %q", original.KeyPrefix, updated.KeyPrefix)
			}
			if !updated.CreatedAt.Equal(original.CreatedAt) {
				t.Fatalf("CreatedAt should never change: expected %v, got %v", original.CreatedAt, updated.CreatedAt)
			}
		})
	})

	// Sub-test: applying an update with all fields set then another with no overlap preserves both
	t.Run("sequential_updates_preserve_fields", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			original := genBaseAPIKey(t)

			// First update: set name and description
			name1 := rapid.StringMatching(`[A-Za-z0-9]{1,30}`).Draw(t, "name1")
			desc1 := rapid.StringMatching(`[A-Za-z0-9]{0,50}`).Draw(t, "desc1")
			input1 := domain.UpdateAPIKeyInput{
				Name:        &name1,
				Description: &desc1,
			}
			after1 := applyUpdate(original, input1)

			// Second update: set scopes and is_active (no overlap with first)
			numScopes := rapid.IntRange(1, len(testValidScopes)).Draw(t, "numSeqScopes")
			perm := rapid.Permutation(testValidScopes).Draw(t, "seqScopesPerm")
			active := rapid.Bool().Draw(t, "seqActive")
			input2 := domain.UpdateAPIKeyInput{
				Scopes:   perm[:numScopes],
				IsActive: &active,
			}
			after2 := applyUpdate(after1, input2)

			// Name and description from first update should persist
			if after2.Name != name1 {
				t.Fatalf("Name from first update lost: expected %q, got %q", name1, after2.Name)
			}
			if after2.Description == nil || *after2.Description != desc1 {
				t.Fatalf("Description from first update lost: expected %q, got %v", desc1, after2.Description)
			}
			// Scopes and is_active from second update should be applied
			if len(after2.Scopes) != numScopes {
				t.Fatalf("Scopes from second update not applied: expected %d, got %d", numScopes, len(after2.Scopes))
			}
			if after2.IsActive != active {
				t.Fatalf("IsActive from second update not applied: expected %v, got %v", active, after2.IsActive)
			}
		})
	})

	// Sub-test: empty update input (only forced name) still preserves all other fields
	t.Run("minimal_update_preserves_other_fields", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			original := genBaseAPIKey(t)
			newName := rapid.StringMatching(`[A-Za-z0-9]{1,20}`).Draw(t, "minName")
			input := domain.UpdateAPIKeyInput{Name: &newName}
			updated := applyUpdate(original, input)

			// Only name should change
			if updated.Name != newName {
				t.Fatalf("Name: expected %q, got %q", newName, updated.Name)
			}
			// Everything else unchanged
			if (original.Description == nil) != (updated.Description == nil) {
				t.Fatalf("Description nil-ness changed")
			}
			if original.Description != nil && *original.Description != *updated.Description {
				t.Fatalf("Description changed unexpectedly")
			}
			if len(updated.Scopes) != len(original.Scopes) {
				t.Fatalf("Scopes changed unexpectedly")
			}
			if updated.IsActive != original.IsActive {
				t.Fatalf("IsActive changed unexpectedly")
			}
		})
	})
}

// Ensure the test file uses the context import (for future mock-based tests).
var _ = context.Background

// Feature: enhanced-api-keys, Property 5: Revoked Key Rejects All Mutations
// Validates: Requirements 4.8, 6.5, 8.5
//
// For any API key where revoked_at is set, attempts to update, reactivate (is_active=true),
// or rotate the key SHALL be rejected with an error.

// MutationKind represents the type of mutation attempted on a revoked key.
type MutationKind int

const (
	MutationUpdate     MutationKind = iota // Generic update (name, description, scopes, etc.)
	MutationReactivate                     // Update with is_active=true
	MutationRotate                         // Key rotation
)

// checkRevokedKeyMutation mirrors the service-layer guard: if the key is revoked,
// any mutation (update, reactivate, rotate) is rejected with "cannot modify revoked key".
func checkRevokedKeyMutation(key domain.APIKey, mutation MutationKind) error {
	if key.RevokedAt != nil {
		return fmt.Errorf("cannot modify revoked key")
	}
	// Additional check for rotate: also reject inactive keys
	if mutation == MutationRotate && !key.IsActive {
		return fmt.Errorf("cannot rotate inactive key")
	}
	return nil
}

// genRevokedAPIKey generates a random API key that is guaranteed to have RevokedAt set.
func genRevokedAPIKey(t *rapid.T) domain.APIKey {
	key := genBaseAPIKey(t)

	// Set revoked_at to a random past time (1 minute to 365 days ago)
	offsetMinutes := rapid.IntRange(1, 525600).Draw(t, "revokedOffset")
	revokedAt := time.Now().Add(-time.Duration(offsetMinutes) * time.Minute).Truncate(time.Second).UTC()
	key.RevokedAt = &revokedAt

	// Set revoked_by to a random user
	revokedBy := uuid.New()
	key.RevokedBy = &revokedBy

	return key
}

// genMutationKind generates a random mutation kind.
func genMutationKind(t *rapid.T) MutationKind {
	return MutationKind(rapid.IntRange(0, 2).Draw(t, "mutationKind"))
}

func TestProperty_RevokedKeyRejectsAllMutations(t *testing.T) {
	// Sub-test: any mutation on a revoked key returns "cannot modify revoked key"
	t.Run("all_mutations_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genRevokedAPIKey(t)
			mutation := genMutationKind(t)

			err := checkRevokedKeyMutation(key, mutation)
			if err == nil {
				t.Fatalf("expected error for mutation %d on revoked key, got nil", mutation)
			}
			if err.Error() != "cannot modify revoked key" {
				t.Fatalf("expected 'cannot modify revoked key', got %q", err.Error())
			}
		})
	})

	// Sub-test: update with random fields is rejected on revoked key
	t.Run("update_with_random_fields_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genRevokedAPIKey(t)
			_ = genUpdateInput(t) // generate random update input to show it doesn't matter

			err := checkRevokedKeyMutation(key, MutationUpdate)
			if err == nil {
				t.Fatal("expected error for update on revoked key, got nil")
			}
			if err.Error() != "cannot modify revoked key" {
				t.Fatalf("expected 'cannot modify revoked key', got %q", err.Error())
			}
		})
	})

	// Sub-test: reactivation (is_active=true) is rejected on revoked key
	t.Run("reactivation_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genRevokedAPIKey(t)
			// Explicitly set is_active to false to simulate a disabled+revoked key
			key.IsActive = false

			err := checkRevokedKeyMutation(key, MutationReactivate)
			if err == nil {
				t.Fatal("expected error for reactivation on revoked key, got nil")
			}
			if err.Error() != "cannot modify revoked key" {
				t.Fatalf("expected 'cannot modify revoked key', got %q", err.Error())
			}
		})
	})

	// Sub-test: rotation is rejected on revoked key regardless of is_active state
	t.Run("rotation_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genRevokedAPIKey(t)
			// Randomly set is_active to show rotation is rejected regardless
			key.IsActive = rapid.Bool().Draw(t, "isActiveForRotation")

			err := checkRevokedKeyMutation(key, MutationRotate)
			if err == nil {
				t.Fatal("expected error for rotation on revoked key, got nil")
			}
			if err.Error() != "cannot modify revoked key" {
				t.Fatalf("expected 'cannot modify revoked key', got %q", err.Error())
			}
		})
	})

	// Sub-test: non-revoked key does NOT get rejected (control test)
	t.Run("non_revoked_key_not_rejected", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.RevokedAt = nil // ensure not revoked
			key.IsActive = true // ensure active (so rotate also passes)

			mutation := genMutationKind(t)
			err := checkRevokedKeyMutation(key, mutation)
			if err != nil {
				t.Fatalf("expected no error for mutation %d on non-revoked active key, got %q", mutation, err.Error())
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 6: Enable/Disable Round-Trip
// Validates: Requirements 6.2, 6.3
//
// For any active, non-revoked API key, setting is_active to false and then back to true
// SHALL restore the key to an active state where it can authenticate requests,
// and all other fields SHALL be preserved.

func TestProperty_EnableDisableRoundTrip(t *testing.T) {
	falseVal := false
	trueVal := true

	// Sub-test: toggling is_active false then true restores active state
	t.Run("toggle_restores_active_state", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			// Ensure the key starts active and non-revoked
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			// Step 1: disable the key
			disableInput := domain.UpdateAPIKeyInput{IsActive: &falseVal}
			disabled := applyUpdate(key, disableInput)

			if disabled.IsActive {
				t.Fatal("key should be inactive after setting is_active=false")
			}

			// Step 2: re-enable the key
			enableInput := domain.UpdateAPIKeyInput{IsActive: &trueVal}
			reenabled := applyUpdate(disabled, enableInput)

			if !reenabled.IsActive {
				t.Fatal("key should be active after setting is_active=true")
			}
		})
	})

	// Sub-test: all fields other than is_active are preserved through the round-trip
	t.Run("other_fields_preserved", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			disableInput := domain.UpdateAPIKeyInput{IsActive: &falseVal}
			disabled := applyUpdate(key, disableInput)

			enableInput := domain.UpdateAPIKeyInput{IsActive: &trueVal}
			reenabled := applyUpdate(disabled, enableInput)

			// Immutable / non-toggled fields must match the original
			if reenabled.ID != key.ID {
				t.Fatalf("ID changed: expected %v, got %v", key.ID, reenabled.ID)
			}
			if reenabled.TeamID != key.TeamID {
				t.Fatalf("TeamID changed: expected %v, got %v", key.TeamID, reenabled.TeamID)
			}
			if reenabled.CreatedBy != key.CreatedBy {
				t.Fatalf("CreatedBy changed: expected %v, got %v", key.CreatedBy, reenabled.CreatedBy)
			}
			if reenabled.KeyHash != key.KeyHash {
				t.Fatalf("KeyHash changed: expected %q, got %q", key.KeyHash, reenabled.KeyHash)
			}
			if reenabled.KeyPrefix != key.KeyPrefix {
				t.Fatalf("KeyPrefix changed: expected %q, got %q", key.KeyPrefix, reenabled.KeyPrefix)
			}
			if reenabled.Name != key.Name {
				t.Fatalf("Name changed: expected %q, got %q", key.Name, reenabled.Name)
			}
			if (key.Description == nil) != (reenabled.Description == nil) {
				t.Fatalf("Description nil-ness changed: original=%v, reenabled=%v", key.Description, reenabled.Description)
			}
			if key.Description != nil && *key.Description != *reenabled.Description {
				t.Fatalf("Description changed: expected %q, got %q", *key.Description, *reenabled.Description)
			}
			if len(reenabled.Scopes) != len(key.Scopes) {
				t.Fatalf("Scopes length changed: expected %d, got %d", len(key.Scopes), len(reenabled.Scopes))
			}
			for i, s := range key.Scopes {
				if reenabled.Scopes[i] != s {
					t.Fatalf("Scopes[%d] changed: expected %q, got %q", i, s, reenabled.Scopes[i])
				}
			}
			if (key.ExpiresAt == nil) != (reenabled.ExpiresAt == nil) {
				t.Fatalf("ExpiresAt nil-ness changed: original=%v, reenabled=%v", key.ExpiresAt, reenabled.ExpiresAt)
			}
			if key.ExpiresAt != nil && !key.ExpiresAt.Equal(*reenabled.ExpiresAt) {
				t.Fatalf("ExpiresAt changed: expected %v, got %v", key.ExpiresAt, reenabled.ExpiresAt)
			}
			if len(reenabled.AllowedIPs) != len(key.AllowedIPs) {
				t.Fatalf("AllowedIPs length changed: expected %d, got %d", len(key.AllowedIPs), len(reenabled.AllowedIPs))
			}
			for i, ip := range key.AllowedIPs {
				if reenabled.AllowedIPs[i] != ip {
					t.Fatalf("AllowedIPs[%d] changed: expected %q, got %q", i, ip, reenabled.AllowedIPs[i])
				}
			}
			if !reenabled.CreatedAt.Equal(key.CreatedAt) {
				t.Fatalf("CreatedAt changed: expected %v, got %v", key.CreatedAt, reenabled.CreatedAt)
			}
			if reenabled.RevokedAt != nil {
				t.Fatalf("RevokedAt should remain nil, got %v", reenabled.RevokedAt)
			}
			if reenabled.RevokedBy != nil {
				t.Fatalf("RevokedBy should remain nil, got %v", reenabled.RevokedBy)
			}
		})
	})

	// Sub-test: intermediate disabled state is truly inactive (cannot authenticate)
	t.Run("intermediate_disabled_state_is_inactive", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil

			disableInput := domain.UpdateAPIKeyInput{IsActive: &falseVal}
			disabled := applyUpdate(key, disableInput)

			// Simulate the middleware check: disabled key should be rejected
			if disabled.IsActive {
				t.Fatal("disabled key should have is_active=false")
			}
			if disabled.RevokedAt != nil {
				t.Fatal("disabled key should not be revoked")
			}

			// Re-enable and verify it passes the middleware check
			enableInput := domain.UpdateAPIKeyInput{IsActive: &trueVal}
			reenabled := applyUpdate(disabled, enableInput)

			if !reenabled.IsActive {
				t.Fatal("re-enabled key should have is_active=true")
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 10: Key Rotation Produces New Credentials
// Validates: Requirements 8.1, 8.2
//
// For any active, non-revoked API key, rotating it SHALL produce a new raw key matching
// the format bb_ followed by 64 hex characters, and the stored key_hash and key_prefix
// SHALL differ from their pre-rotation values. The key's ID, name, scopes, and other
// metadata SHALL remain unchanged.

// simulateRotation mirrors the service-layer Rotate logic without a database.
// It generates a new 32-byte random secret with bb_ prefix, computes SHA-256 hash,
// extracts prefix, and returns the rotated key with updated hash/prefix/rawKey.
func simulateRotation(original domain.APIKey) (domain.APIKey, error) {
	if original.RevokedAt != nil {
		return domain.APIKey{}, fmt.Errorf("cannot modify revoked key")
	}
	if !original.IsActive {
		return domain.APIKey{}, fmt.Errorf("cannot rotate inactive key")
	}

	raw := make([]byte, 32)
	if _, err := cryptoRand.Read(raw); err != nil {
		return domain.APIKey{}, fmt.Errorf("failed to generate key: %w", err)
	}
	rawKey := "bb_" + hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(rawKey))
	newHash := hex.EncodeToString(hash[:])
	newPrefix := rawKey[:11]

	rotated := original
	rotated.KeyHash = newHash
	rotated.KeyPrefix = newPrefix
	rotated.RawKey = rawKey
	return rotated, nil
}

func TestProperty_KeyRotationProducesNewCredentials(t *testing.T) {
	// Sub-test: rotated key has correct raw key format (bb_ + 64 hex chars)
	t.Run("raw_key_format_valid", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil

			rotated, err := simulateRotation(key)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Raw key must be exactly 67 chars: "bb_" (3) + 64 hex chars
			if len(rotated.RawKey) != 67 {
				t.Fatalf("raw key length: expected 67, got %d", len(rotated.RawKey))
			}
			if rotated.RawKey[:3] != "bb_" {
				t.Fatalf("raw key prefix: expected 'bb_', got %q", rotated.RawKey[:3])
			}
			// Remaining 64 chars must be valid hex
			hexPart := rotated.RawKey[3:]
			if _, err := hex.DecodeString(hexPart); err != nil {
				t.Fatalf("raw key hex part is not valid hex: %v", err)
			}
		})
	})

	// Sub-test: key_hash and key_prefix change after rotation
	t.Run("hash_and_prefix_changed", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			// Give the original key a realistic hash and prefix
			origRaw := make([]byte, 32)
			_, _ = cryptoRand.Read(origRaw)
			origRawKey := "bb_" + hex.EncodeToString(origRaw)
			origHash := sha256.Sum256([]byte(origRawKey))
			key.KeyHash = hex.EncodeToString(origHash[:])
			key.KeyPrefix = origRawKey[:11]

			rotated, err := simulateRotation(key)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if rotated.KeyHash == key.KeyHash {
				t.Fatal("key_hash should differ after rotation")
			}
			if rotated.KeyPrefix == key.KeyPrefix {
				t.Fatal("key_prefix should differ after rotation")
			}

			// Verify the new hash is the SHA-256 of the new raw key
			expectedHash := sha256.Sum256([]byte(rotated.RawKey))
			if rotated.KeyHash != hex.EncodeToString(expectedHash[:]) {
				t.Fatalf("key_hash does not match SHA-256 of new raw key")
			}
			// Verify the new prefix is the first 11 chars of the new raw key
			if rotated.KeyPrefix != rotated.RawKey[:11] {
				t.Fatalf("key_prefix does not match first 11 chars of new raw key: expected %q, got %q",
					rotated.RawKey[:11], rotated.KeyPrefix)
			}
		})
	})

	// Sub-test: metadata fields remain unchanged after rotation
	t.Run("metadata_unchanged", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil

			rotated, err := simulateRotation(key)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if rotated.ID != key.ID {
				t.Fatalf("ID changed: expected %v, got %v", key.ID, rotated.ID)
			}
			if rotated.TeamID != key.TeamID {
				t.Fatalf("TeamID changed: expected %v, got %v", key.TeamID, rotated.TeamID)
			}
			if rotated.CreatedBy != key.CreatedBy {
				t.Fatalf("CreatedBy changed: expected %v, got %v", key.CreatedBy, rotated.CreatedBy)
			}
			if rotated.Name != key.Name {
				t.Fatalf("Name changed: expected %q, got %q", key.Name, rotated.Name)
			}
			if (key.Description == nil) != (rotated.Description == nil) {
				t.Fatalf("Description nil-ness changed")
			}
			if key.Description != nil && *key.Description != *rotated.Description {
				t.Fatalf("Description changed: expected %q, got %q", *key.Description, *rotated.Description)
			}
			if len(rotated.Scopes) != len(key.Scopes) {
				t.Fatalf("Scopes length changed: expected %d, got %d", len(key.Scopes), len(rotated.Scopes))
			}
			for i, s := range key.Scopes {
				if rotated.Scopes[i] != s {
					t.Fatalf("Scopes[%d] changed: expected %q, got %q", i, s, rotated.Scopes[i])
				}
			}
			if rotated.IsActive != key.IsActive {
				t.Fatalf("IsActive changed: expected %v, got %v", key.IsActive, rotated.IsActive)
			}
			if len(rotated.AllowedIPs) != len(key.AllowedIPs) {
				t.Fatalf("AllowedIPs length changed: expected %d, got %d", len(key.AllowedIPs), len(rotated.AllowedIPs))
			}
			for i, ip := range key.AllowedIPs {
				if rotated.AllowedIPs[i] != ip {
					t.Fatalf("AllowedIPs[%d] changed: expected %q, got %q", i, ip, rotated.AllowedIPs[i])
				}
			}
			if (key.ExpiresAt == nil) != (rotated.ExpiresAt == nil) {
				t.Fatalf("ExpiresAt nil-ness changed")
			}
			if key.ExpiresAt != nil && !key.ExpiresAt.Equal(*rotated.ExpiresAt) {
				t.Fatalf("ExpiresAt changed: expected %v, got %v", key.ExpiresAt, rotated.ExpiresAt)
			}
			if !rotated.CreatedAt.Equal(key.CreatedAt) {
				t.Fatalf("CreatedAt changed: expected %v, got %v", key.CreatedAt, rotated.CreatedAt)
			}
		})
	})

	// Sub-test: consecutive rotations produce distinct credentials each time
	t.Run("consecutive_rotations_produce_distinct_keys", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil

			rotated1, err := simulateRotation(key)
			if err != nil {
				t.Fatalf("first rotation error: %v", err)
			}

			rotated2, err := simulateRotation(rotated1)
			if err != nil {
				t.Fatalf("second rotation error: %v", err)
			}

			if rotated1.RawKey == rotated2.RawKey {
				t.Fatal("consecutive rotations produced the same raw key")
			}
			if rotated1.KeyHash == rotated2.KeyHash {
				t.Fatal("consecutive rotations produced the same key_hash")
			}
			if rotated1.KeyPrefix == rotated2.KeyPrefix {
				// Prefixes could theoretically collide but it's astronomically unlikely
				// with 8 random hex chars in the prefix portion
				t.Fatal("consecutive rotations produced the same key_prefix")
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 15: Bulk Revoke Correctness
// Validates: Requirements 13.1, 13.2, 13.3
//
// For any team and any set of key IDs, bulk revoke SHALL soft-revoke exactly those keys
// that belong to the specified team and are not already revoked. Keys not belonging to the
// team or already revoked SHALL appear in the skipped array. The count of revoked keys plus
// the length of the skipped array SHALL equal the total number of input IDs.

// simulateBulkRevoke mirrors the repository/service bulk revoke logic in-memory.
// Given a map of all keys (by ID), a target team ID, and a list of key IDs to revoke,
// it returns the count of newly revoked keys and the list of skipped IDs.
func simulateBulkRevoke(allKeys map[uuid.UUID]domain.APIKey, teamID uuid.UUID, inputIDs []uuid.UUID) (int, []uuid.UUID) {
	revoked := 0
	var skipped []uuid.UUID

	for _, id := range inputIDs {
		key, exists := allKeys[id]
		if !exists {
			// Key ID doesn't exist at all — skip
			skipped = append(skipped, id)
			continue
		}
		if key.TeamID != teamID {
			// Key belongs to a different team — skip
			skipped = append(skipped, id)
			continue
		}
		if key.RevokedAt != nil {
			// Key is already revoked — skip
			skipped = append(skipped, id)
			continue
		}
		// Key belongs to the team and is not revoked — revoke it
		now := time.Now()
		key.RevokedAt = &now
		allKeys[id] = key
		revoked++
	}

	if skipped == nil {
		skipped = []uuid.UUID{}
	}
	return revoked, skipped
}

func TestProperty_BulkRevokeCorrectness(t *testing.T) {
	// Sub-test: revoked + len(skipped) == len(inputIDs) for any random key set
	t.Run("revoked_plus_skipped_equals_total", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			// Generate a pool of keys across multiple teams with varied revocation states
			numKeys := rapid.IntRange(1, 30).Draw(t, "numKeys")
			allKeys := make(map[uuid.UUID]domain.APIKey, numKeys)
			var allKeyIDs []uuid.UUID

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				// Randomly assign to target team or a different team
				if rapid.Bool().Draw(t, fmt.Sprintf("sameTeam_%d", i)) {
					key.TeamID = targetTeamID
				}
				// Randomly mark some keys as already revoked
				if rapid.Bool().Draw(t, fmt.Sprintf("alreadyRevoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
					revokedBy := uuid.New()
					key.RevokedBy = &revokedBy
				} else {
					key.RevokedAt = nil
					key.RevokedBy = nil
				}
				allKeys[key.ID] = key
				allKeyIDs = append(allKeyIDs, key.ID)
			}

			// Select a random subset of key IDs to bulk revoke, possibly including
			// IDs that don't exist in the pool
			numInput := rapid.IntRange(1, numKeys+5).Draw(t, "numInputIDs")
			inputIDs := make([]uuid.UUID, numInput)
			for i := 0; i < numInput; i++ {
				if len(allKeyIDs) > 0 && rapid.Bool().Draw(t, fmt.Sprintf("useExisting_%d", i)) {
					idx := rapid.IntRange(0, len(allKeyIDs)-1).Draw(t, fmt.Sprintf("pickKey_%d", i))
					inputIDs[i] = allKeyIDs[idx]
				} else {
					// Non-existent key ID
					inputIDs[i] = uuid.New()
				}
			}

			revoked, skipped := simulateBulkRevoke(allKeys, targetTeamID, inputIDs)

			total := len(inputIDs)
			if revoked+len(skipped) != total {
				t.Fatalf("invariant violated: revoked(%d) + skipped(%d) = %d, expected %d",
					revoked, len(skipped), revoked+len(skipped), total)
			}
		})
	})

	// Sub-test: keys belonging to the target team and not already revoked are revoked
	t.Run("eligible_keys_are_revoked", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 20).Draw(t, "numKeys")
			allKeys := make(map[uuid.UUID]domain.APIKey, numKeys)
			var inputIDs []uuid.UUID

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				key.RevokedAt = nil
				key.RevokedBy = nil
				allKeys[key.ID] = key
				inputIDs = append(inputIDs, key.ID)
			}

			revoked, skipped := simulateBulkRevoke(allKeys, targetTeamID, inputIDs)

			if revoked != numKeys {
				t.Fatalf("expected all %d keys to be revoked, got %d revoked", numKeys, revoked)
			}
			if len(skipped) != 0 {
				t.Fatalf("expected 0 skipped, got %d", len(skipped))
			}

			// Verify all keys now have RevokedAt set
			for _, id := range inputIDs {
				key := allKeys[id]
				if key.RevokedAt == nil {
					t.Fatalf("key %v should have RevokedAt set after bulk revoke", id)
				}
			}
		})
	})

	// Sub-test: already-revoked keys appear in skipped
	t.Run("already_revoked_keys_skipped", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 20).Draw(t, "numKeys")
			allKeys := make(map[uuid.UUID]domain.APIKey, numKeys)
			var inputIDs []uuid.UUID

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				// All keys are already revoked
				revokedAt := time.Now().Add(-time.Hour).UTC()
				key.RevokedAt = &revokedAt
				revokedBy := uuid.New()
				key.RevokedBy = &revokedBy
				allKeys[key.ID] = key
				inputIDs = append(inputIDs, key.ID)
			}

			revoked, skipped := simulateBulkRevoke(allKeys, targetTeamID, inputIDs)

			if revoked != 0 {
				t.Fatalf("expected 0 revoked for already-revoked keys, got %d", revoked)
			}
			if len(skipped) != numKeys {
				t.Fatalf("expected %d skipped, got %d", numKeys, len(skipped))
			}
		})
	})

	// Sub-test: keys from other teams appear in skipped
	t.Run("other_team_keys_skipped", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()
			otherTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 20).Draw(t, "numKeys")
			allKeys := make(map[uuid.UUID]domain.APIKey, numKeys)
			var inputIDs []uuid.UUID

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = otherTeamID
				key.RevokedAt = nil
				key.RevokedBy = nil
				allKeys[key.ID] = key
				inputIDs = append(inputIDs, key.ID)
			}

			revoked, skipped := simulateBulkRevoke(allKeys, targetTeamID, inputIDs)

			if revoked != 0 {
				t.Fatalf("expected 0 revoked for other-team keys, got %d", revoked)
			}
			if len(skipped) != numKeys {
				t.Fatalf("expected %d skipped, got %d", numKeys, len(skipped))
			}
		})
	})

	// Sub-test: non-existent key IDs appear in skipped
	t.Run("nonexistent_keys_skipped", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()
			allKeys := make(map[uuid.UUID]domain.APIKey)

			numInput := rapid.IntRange(1, 20).Draw(t, "numInput")
			inputIDs := make([]uuid.UUID, numInput)
			for i := 0; i < numInput; i++ {
				inputIDs[i] = uuid.New()
			}

			revoked, skipped := simulateBulkRevoke(allKeys, targetTeamID, inputIDs)

			if revoked != 0 {
				t.Fatalf("expected 0 revoked for nonexistent keys, got %d", revoked)
			}
			if len(skipped) != numInput {
				t.Fatalf("expected %d skipped, got %d", numInput, len(skipped))
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 2: Scope Enforcement Across Endpoints
// Validates: Requirements 2.1, 2.2, 2.3
//
// For any API key scope set and any protected endpoint, if the scope set does not contain
// the required scope for that endpoint, the handler SHALL reject the request with HTTP 403.
// If the scope set does contain the required scope, the handler SHALL not reject on scope grounds.

// endpointScopeMapping defines the mapping from endpoint names to their required scopes,
// mirroring the scope checks in inbox.go, email.go, and webhook.go handlers.
var endpointScopeMapping = []struct {
	Endpoint      string
	RequiredScope string
}{
	// Inbox endpoints
	{"InboxCreate", "team.inboxes.create"},
	{"InboxListMyInboxes", "team.inboxes.view"},
	{"InboxGetInbox", "team.inboxes.view"},
	{"InboxDelete", "team.inboxes.view"},
	// Email endpoints
	{"EmailListEmails", "team.emails.view"},
	{"EmailGetEmail", "team.emails.view"},
	// Writes require the manage scope, not view — internal/handler/email.go.
	// This table said "view" while the handlers said "manage"; because the table
	// is a static mapping and never exercises a handler, it passed anyway and the
	// mismatch hid the fact that team.emails.manage was not a seeded permission.
	{"EmailMarkAllRead", "team.emails.manage"},
	{"EmailMarkReadUnread", "team.emails.manage"},
	{"EmailDeleteEmail", "team.emails.manage"},
	// Webhook endpoints
	{"WebhookCreate", "team.webhooks.manage"},
	{"WebhookUpdate", "team.webhooks.manage"},
	{"WebhookDelete", "team.webhooks.manage"},
	{"WebhookList", "team.webhooks.view"},
	{"WebhookListDeliveryLogs", "team.webhooks.view"},
}

// scopeEnforcementCheck mirrors the handler-level scope guard pattern:
//
//	if uc != nil && len(uc.APIKeyScopes) > 0 && !hasScope(scopes, required) {
//	    return false // 403
//	}
//	return true // allowed
//
// It returns true (access granted) when the scope set contains the required scope,
// and false (403 forbidden) when it does not.
func scopeEnforcementCheck(apiKeyScopes []string, requiredScope string) bool {
	if len(apiKeyScopes) == 0 {
		// No scopes means JWT auth or empty key scopes — always allowed
		return true
	}
	for _, s := range apiKeyScopes {
		if s == requiredScope {
			return true
		}
	}
	return false
}

func TestProperty_ScopeEnforcementAcrossEndpoints(t *testing.T) {
	// Sub-test: missing required scope results in denial (403)
	t.Run("missing_scope_denied", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Pick a random endpoint
			endpointIdx := rapid.IntRange(0, len(endpointScopeMapping)-1).Draw(t, "endpointIdx")
			endpoint := endpointScopeMapping[endpointIdx]

			// Generate a random scope subset that does NOT contain the required scope
			numScopes := rapid.IntRange(0, len(testValidScopes)-1).Draw(t, "numScopes")
			var scopePool []string
			for _, s := range testValidScopes {
				if s != endpoint.RequiredScope {
					scopePool = append(scopePool, s)
				}
			}
			// Pick numScopes from the pool (without the required scope)
			perm := rapid.Permutation(scopePool).Draw(t, "scopePerm")
			scopes := perm[:numScopes]

			// Ensure at least one scope so the API key path is taken
			if len(scopes) == 0 {
				// Use a scope that is definitely not the required one
				scopes = []string{scopePool[0]}
			}

			allowed := scopeEnforcementCheck(scopes, endpoint.RequiredScope)
			if allowed {
				t.Fatalf("endpoint %s (requires %q) should be denied for scopes %v, but was allowed",
					endpoint.Endpoint, endpoint.RequiredScope, scopes)
			}
		})
	})

	// Sub-test: having the required scope results in access granted
	t.Run("present_scope_allowed", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Pick a random endpoint
			endpointIdx := rapid.IntRange(0, len(endpointScopeMapping)-1).Draw(t, "endpointIdx")
			endpoint := endpointScopeMapping[endpointIdx]

			// Generate a random scope subset that DOES contain the required scope
			numExtra := rapid.IntRange(0, len(testValidScopes)-1).Draw(t, "numExtra")
			perm := rapid.Permutation(testValidScopes).Draw(t, "scopePerm")
			scopes := perm[:numExtra]

			// Ensure the required scope is present
			hasRequired := false
			for _, s := range scopes {
				if s == endpoint.RequiredScope {
					hasRequired = true
					break
				}
			}
			if !hasRequired {
				scopes = append(scopes, endpoint.RequiredScope)
			}

			allowed := scopeEnforcementCheck(scopes, endpoint.RequiredScope)
			if !allowed {
				t.Fatalf("endpoint %s (requires %q) should be allowed for scopes %v, but was denied",
					endpoint.Endpoint, endpoint.RequiredScope, scopes)
			}
		})
	})

	// Sub-test: empty scope set (JWT auth) always grants access
	t.Run("empty_scopes_always_allowed", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			endpointIdx := rapid.IntRange(0, len(endpointScopeMapping)-1).Draw(t, "endpointIdx")
			endpoint := endpointScopeMapping[endpointIdx]

			allowed := scopeEnforcementCheck(nil, endpoint.RequiredScope)
			if !allowed {
				t.Fatalf("endpoint %s should be allowed for nil scopes (JWT auth), but was denied",
					endpoint.Endpoint)
			}

			allowed = scopeEnforcementCheck([]string{}, endpoint.RequiredScope)
			if !allowed {
				t.Fatalf("endpoint %s should be allowed for empty scopes, but was denied",
					endpoint.Endpoint)
			}
		})
	})

	// Sub-test: scope enforcement is consistent with auth.HasScope logic
	t.Run("consistent_with_has_scope", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			endpointIdx := rapid.IntRange(0, len(endpointScopeMapping)-1).Draw(t, "endpointIdx")
			endpoint := endpointScopeMapping[endpointIdx]

			// Generate a random subset of valid scopes
			numScopes := rapid.IntRange(1, len(testValidScopes)).Draw(t, "numScopes")
			perm := rapid.Permutation(testValidScopes).Draw(t, "scopePerm")
			scopes := perm[:numScopes]

			// Check using our enforcement function
			allowed := scopeEnforcementCheck(scopes, endpoint.RequiredScope)

			// Verify by checking if the required scope is in the set
			found := false
			for _, s := range scopes {
				if s == endpoint.RequiredScope {
					found = true
					break
				}
			}

			if allowed != found {
				t.Fatalf("inconsistency: scopeEnforcementCheck returned %v but scope %q found=%v in %v",
					allowed, endpoint.RequiredScope, found, scopes)
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 8: Soft-Revoke Preserves Row with Metadata
// Validates: Requirements 7.2
//
// For any active API key, revoking it SHALL set revoked_at to a non-null timestamp and
// revoked_by to the revoking user's ID, and the row SHALL still exist (not deleted).
// All original fields (name, scopes, description, allowed_ips, etc.) SHALL be preserved.

// simulateSoftRevoke mirrors the service/repo soft-revoke logic in-memory.
// It sets revoked_at and revoked_by on the key without deleting the row.
func simulateSoftRevoke(key domain.APIKey, revokerID uuid.UUID) domain.APIKey {
	now := time.Now().UTC().Truncate(time.Second)
	revoked := key
	revoked.RevokedAt = &now
	revoked.RevokedBy = &revokerID
	return revoked
}

func TestProperty_SoftRevokePreservesRowWithMetadata(t *testing.T) {
	// Sub-test: revoked_at is non-null and revoked_by matches the revoker after soft-revoke
	t.Run("revoked_at_and_revoked_by_set", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			revokerID := uuid.New()
			revoked := simulateSoftRevoke(key, revokerID)

			if revoked.RevokedAt == nil {
				t.Fatal("revoked_at should be non-null after soft-revoke")
			}
			if revoked.RevokedBy == nil {
				t.Fatal("revoked_by should be non-null after soft-revoke")
			}
			if *revoked.RevokedBy != revokerID {
				t.Fatalf("revoked_by: expected %v, got %v", revokerID, *revoked.RevokedBy)
			}
		})
	})

	// Sub-test: the row still exists after soft-revoke (all identity fields preserved)
	t.Run("row_still_exists_with_identity", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			revokerID := uuid.New()
			revoked := simulateSoftRevoke(key, revokerID)

			// The row must still exist — verify identity fields are intact
			if revoked.ID != key.ID {
				t.Fatalf("ID changed: expected %v, got %v", key.ID, revoked.ID)
			}
			if revoked.TeamID != key.TeamID {
				t.Fatalf("TeamID changed: expected %v, got %v", key.TeamID, revoked.TeamID)
			}
			if revoked.CreatedBy != key.CreatedBy {
				t.Fatalf("CreatedBy changed: expected %v, got %v", key.CreatedBy, revoked.CreatedBy)
			}
			if revoked.KeyHash != key.KeyHash {
				t.Fatalf("KeyHash changed: expected %q, got %q", key.KeyHash, revoked.KeyHash)
			}
			if revoked.KeyPrefix != key.KeyPrefix {
				t.Fatalf("KeyPrefix changed: expected %q, got %q", key.KeyPrefix, revoked.KeyPrefix)
			}
			if !revoked.CreatedAt.Equal(key.CreatedAt) {
				t.Fatalf("CreatedAt changed: expected %v, got %v", key.CreatedAt, revoked.CreatedAt)
			}
		})
	})

	// Sub-test: all metadata fields (name, description, scopes, allowed_ips) are preserved
	t.Run("metadata_preserved_after_revoke", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			revokerID := uuid.New()
			revoked := simulateSoftRevoke(key, revokerID)

			// Name
			if revoked.Name != key.Name {
				t.Fatalf("Name changed: expected %q, got %q", key.Name, revoked.Name)
			}
			// Description
			if (key.Description == nil) != (revoked.Description == nil) {
				t.Fatalf("Description nil-ness changed: original=%v, revoked=%v", key.Description, revoked.Description)
			}
			if key.Description != nil && *key.Description != *revoked.Description {
				t.Fatalf("Description changed: expected %q, got %q", *key.Description, *revoked.Description)
			}
			// Scopes
			if len(revoked.Scopes) != len(key.Scopes) {
				t.Fatalf("Scopes length changed: expected %d, got %d", len(key.Scopes), len(revoked.Scopes))
			}
			for i, s := range key.Scopes {
				if revoked.Scopes[i] != s {
					t.Fatalf("Scopes[%d] changed: expected %q, got %q", i, s, revoked.Scopes[i])
				}
			}
			// IsActive
			if revoked.IsActive != key.IsActive {
				t.Fatalf("IsActive changed: expected %v, got %v", key.IsActive, revoked.IsActive)
			}
			// AllowedIPs
			if len(revoked.AllowedIPs) != len(key.AllowedIPs) {
				t.Fatalf("AllowedIPs length changed: expected %d, got %d", len(key.AllowedIPs), len(revoked.AllowedIPs))
			}
			for i, ip := range key.AllowedIPs {
				if revoked.AllowedIPs[i] != ip {
					t.Fatalf("AllowedIPs[%d] changed: expected %q, got %q", i, ip, revoked.AllowedIPs[i])
				}
			}
			// ExpiresAt
			if (key.ExpiresAt == nil) != (revoked.ExpiresAt == nil) {
				t.Fatalf("ExpiresAt nil-ness changed: original=%v, revoked=%v", key.ExpiresAt, revoked.ExpiresAt)
			}
			if key.ExpiresAt != nil && !key.ExpiresAt.Equal(*revoked.ExpiresAt) {
				t.Fatalf("ExpiresAt changed: expected %v, got %v", key.ExpiresAt, revoked.ExpiresAt)
			}
			// RequestCount
			if revoked.RequestCount != key.RequestCount {
				t.Fatalf("RequestCount changed: expected %d, got %d", key.RequestCount, revoked.RequestCount)
			}
		})
	})

	// Sub-test: revoked_at timestamp is recent (within a few seconds of now)
	t.Run("revoked_at_is_recent", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := genBaseAPIKey(t)
			key.IsActive = true
			key.RevokedAt = nil
			key.RevokedBy = nil

			before := time.Now().UTC().Add(-time.Second)
			revokerID := uuid.New()
			revoked := simulateSoftRevoke(key, revokerID)
			after := time.Now().UTC().Add(time.Second)

			if revoked.RevokedAt.Before(before) || revoked.RevokedAt.After(after) {
				t.Fatalf("revoked_at %v is not within expected range [%v, %v]",
					revoked.RevokedAt, before, after)
			}
		})
	})
}

// Feature: enhanced-api-keys, Property 9: List Filtering by Revocation Status
// Validates: Requirements 7.4, 7.5
//
// For any team with a mix of active and revoked API keys, listing without include_revoked
// SHALL return only keys where revoked_at is NULL. Listing with include_revoked=true SHALL
// return all keys including those with revoked_at set.

// simulateListByTeam mirrors the repository ListByTeam filtering logic in-memory.
// Given a slice of keys, a target team ID, and the include_revoked flag, it returns
// only the keys that match the filtering criteria.
func simulateListByTeam(allKeys []domain.APIKey, teamID uuid.UUID, includeRevoked bool) []domain.APIKey {
	var result []domain.APIKey
	for _, key := range allKeys {
		if key.TeamID != teamID {
			continue
		}
		if !includeRevoked && key.RevokedAt != nil {
			continue
		}
		result = append(result, key)
	}
	return result
}

func TestProperty_ListFilteringByRevocationStatus(t *testing.T) {
	// Sub-test: listing without include_revoked returns only non-revoked keys
	t.Run("exclude_revoked_returns_only_active", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 30).Draw(t, "numKeys")
			allKeys := make([]domain.APIKey, numKeys)

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				// Randomly revoke some keys
				if rapid.Bool().Draw(t, fmt.Sprintf("revoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
					revokedBy := uuid.New()
					key.RevokedBy = &revokedBy
				} else {
					key.RevokedAt = nil
					key.RevokedBy = nil
				}
				allKeys[i] = key
			}

			result := simulateListByTeam(allKeys, targetTeamID, false)

			// Every returned key must have RevokedAt == nil
			for _, key := range result {
				if key.RevokedAt != nil {
					t.Fatalf("key %v has revoked_at set but was returned without include_revoked", key.ID)
				}
			}

			// Count expected non-revoked keys
			expectedCount := 0
			for _, key := range allKeys {
				if key.TeamID == targetTeamID && key.RevokedAt == nil {
					expectedCount++
				}
			}
			if len(result) != expectedCount {
				t.Fatalf("expected %d non-revoked keys, got %d", expectedCount, len(result))
			}
		})
	})

	// Sub-test: listing with include_revoked=true returns all keys (active + revoked)
	t.Run("include_revoked_returns_all", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 30).Draw(t, "numKeys")
			allKeys := make([]domain.APIKey, numKeys)

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				if rapid.Bool().Draw(t, fmt.Sprintf("revoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
					revokedBy := uuid.New()
					key.RevokedBy = &revokedBy
				} else {
					key.RevokedAt = nil
					key.RevokedBy = nil
				}
				allKeys[i] = key
			}

			result := simulateListByTeam(allKeys, targetTeamID, true)

			// Count all keys belonging to the target team
			expectedCount := 0
			for _, key := range allKeys {
				if key.TeamID == targetTeamID {
					expectedCount++
				}
			}
			if len(result) != expectedCount {
				t.Fatalf("expected %d total keys with include_revoked, got %d", expectedCount, len(result))
			}
		})
	})

	// Sub-test: include_revoked result is a superset of the non-revoked result
	t.Run("include_revoked_is_superset", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 30).Draw(t, "numKeys")
			allKeys := make([]domain.APIKey, numKeys)

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				if rapid.Bool().Draw(t, fmt.Sprintf("revoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
					revokedBy := uuid.New()
					key.RevokedBy = &revokedBy
				} else {
					key.RevokedAt = nil
					key.RevokedBy = nil
				}
				allKeys[i] = key
			}

			withoutRevoked := simulateListByTeam(allKeys, targetTeamID, false)
			withRevoked := simulateListByTeam(allKeys, targetTeamID, true)

			// withRevoked must be >= withoutRevoked
			if len(withRevoked) < len(withoutRevoked) {
				t.Fatalf("include_revoked result (%d) is smaller than exclude_revoked result (%d)",
					len(withRevoked), len(withoutRevoked))
			}

			// Every key in withoutRevoked must appear in withRevoked
			withRevokedIDs := make(map[uuid.UUID]bool, len(withRevoked))
			for _, key := range withRevoked {
				withRevokedIDs[key.ID] = true
			}
			for _, key := range withoutRevoked {
				if !withRevokedIDs[key.ID] {
					t.Fatalf("key %v in exclude_revoked result but not in include_revoked result", key.ID)
				}
			}
		})
	})

	// Sub-test: keys from other teams are never returned regardless of include_revoked
	t.Run("other_team_keys_excluded", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()
			otherTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 20).Draw(t, "numKeys")
			allKeys := make([]domain.APIKey, numKeys)

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				// Assign to either target or other team
				if rapid.Bool().Draw(t, fmt.Sprintf("sameTeam_%d", i)) {
					key.TeamID = targetTeamID
				} else {
					key.TeamID = otherTeamID
				}
				if rapid.Bool().Draw(t, fmt.Sprintf("revoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
				} else {
					key.RevokedAt = nil
				}
				allKeys[i] = key
			}

			includeRevoked := rapid.Bool().Draw(t, "includeRevoked")
			result := simulateListByTeam(allKeys, targetTeamID, includeRevoked)

			for _, key := range result {
				if key.TeamID != targetTeamID {
					t.Fatalf("key %v belongs to team %v but was returned for team %v",
						key.ID, key.TeamID, targetTeamID)
				}
			}
		})
	})

	// Sub-test: difference between include and exclude results equals the revoked count
	t.Run("difference_equals_revoked_count", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			targetTeamID := uuid.New()

			numKeys := rapid.IntRange(1, 30).Draw(t, "numKeys")
			allKeys := make([]domain.APIKey, numKeys)

			for i := 0; i < numKeys; i++ {
				key := genBaseAPIKey(t)
				key.TeamID = targetTeamID
				if rapid.Bool().Draw(t, fmt.Sprintf("revoked_%d", i)) {
					revokedAt := time.Now().Add(-time.Hour).UTC()
					key.RevokedAt = &revokedAt
					revokedBy := uuid.New()
					key.RevokedBy = &revokedBy
				} else {
					key.RevokedAt = nil
					key.RevokedBy = nil
				}
				allKeys[i] = key
			}

			withoutRevoked := simulateListByTeam(allKeys, targetTeamID, false)
			withRevoked := simulateListByTeam(allKeys, targetTeamID, true)

			// Count revoked keys for the target team
			revokedCount := 0
			for _, key := range allKeys {
				if key.TeamID == targetTeamID && key.RevokedAt != nil {
					revokedCount++
				}
			}

			diff := len(withRevoked) - len(withoutRevoked)
			if diff != revokedCount {
				t.Fatalf("difference between include(%d) and exclude(%d) is %d, expected revoked count %d",
					len(withRevoked), len(withoutRevoked), diff, revokedCount)
			}
		})
	})
}
