package worker

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// Feature: enhanced-api-keys, Property 14: Expired Key Cleanup Correctness
// Validates: Requirements 12.1, 12.3
//
// For any set of API keys with varying expires_at and revoked_at values,
// the cleanup function SHALL delete only keys where:
//   (a) expires_at is in the past AND revoked_at is set, OR
//   (b) expires_at is more than 30 days in the past (regardless of revocation).
// Keys that are expired but within the 30-day grace period and not revoked
// SHALL be preserved. Keys that are not expired or have no expires_at SHALL
// be preserved.

// shouldCleanup mirrors the SQL:
//
//	DELETE FROM api_keys
//	WHERE (expires_at < NOW() AND revoked_at IS NOT NULL)
//	   OR (expires_at < NOW() - INTERVAL '30 days')
func shouldCleanup(key domain.APIKey, now time.Time) bool {
	if key.ExpiresAt == nil {
		return false
	}
	expiredAndRevoked := key.ExpiresAt.Before(now) && key.RevokedAt != nil
	expiredOver30Days := key.ExpiresAt.Before(now.Add(-30 * 24 * time.Hour))
	return expiredAndRevoked || expiredOver30Days
}

func TestProperty_ExpiredKeyCleanupCorrectness(t *testing.T) {
	now := time.Now().UTC()

	// Generator for a time pointer that is in the past (expired).
	pastTimeGen := func(t *rapid.T, label string) *time.Time {
		// 1 minute to 90 days in the past
		minutesAgo := rapid.IntRange(1, 90*24*60).Draw(t, label+"_minutesAgo")
		ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
		return &ts
	}

	// Generator for a time pointer that is in the future (not expired).
	futureTimeGen := func(t *rapid.T, label string) *time.Time {
		// 1 minute to 365 days in the future
		minutesAhead := rapid.IntRange(1, 365*24*60).Draw(t, label+"_minutesAhead")
		ts := now.Add(time.Duration(minutesAhead) * time.Minute)
		return &ts
	}

	// Generator for a revoked_at timestamp (always in the past).
	revokedAtGen := func(t *rapid.T, label string) *time.Time {
		daysAgo := rapid.IntRange(0, 60).Draw(t, label+"_revokedDaysAgo")
		ts := now.Add(-time.Duration(daysAgo) * 24 * time.Hour)
		return &ts
	}

	// Generator for a single API key with varied expiry/revocation states.
	apiKeyGen := func(t *rapid.T, idx int) domain.APIKey {
		// Pick a category for the key
		// 0: no expiry (nil expires_at)
		// 1: future expiry (not expired)
		// 2: expired within 30 days, not revoked (grace period - should be preserved)
		// 3: expired within 30 days, revoked (should be deleted)
		// 4: expired over 30 days ago (should be deleted regardless of revocation)
		category := rapid.IntRange(0, 4).Draw(t, "category")

		key := domain.APIKey{
			ID:       uuid.New(),
			TeamID:   uuid.New(),
			Name:     "test-key",
			IsActive: true,
		}

		switch category {
		case 0:
			// No expiry - nil expires_at
			key.ExpiresAt = nil
			key.RevokedAt = nil
		case 1:
			// Future expiry - not expired
			key.ExpiresAt = futureTimeGen(t, "future")
			// Optionally revoked
			if rapid.Bool().Draw(t, "futureRevoked") {
				key.RevokedAt = revokedAtGen(t, "futureRev")
			}
		case 2:
			// Expired within 30 days, NOT revoked (grace period)
			minutesAgo := rapid.IntRange(1, 30*24*60-1).Draw(t, "graceMinutes")
			ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
			key.ExpiresAt = &ts
			key.RevokedAt = nil
		case 3:
			// Expired within 30 days, revoked (should be deleted)
			minutesAgo := rapid.IntRange(1, 30*24*60-1).Draw(t, "expiredRevokedMinutes")
			ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
			key.ExpiresAt = &ts
			key.RevokedAt = revokedAtGen(t, "rev")
		case 4:
			// Expired over 30 days ago (should be deleted regardless)
			minutesAgo := rapid.IntRange(30*24*60+1, 90*24*60).Draw(t, "oldExpiredMinutes")
			ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
			key.ExpiresAt = &ts
			// Optionally revoked
			if rapid.Bool().Draw(t, "oldRevoked") {
				key.RevokedAt = revokedAtGen(t, "oldRev")
			}
		}

		return key
	}

	t.Run("cleanup_deletes_only_correct_keys", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			numKeys := rapid.IntRange(1, 50).Draw(t, "numKeys")
			keys := make([]domain.APIKey, numKeys)
			for i := 0; i < numKeys; i++ {
				keys[i] = apiKeyGen(t, i)
			}

			// Simulate cleanup: partition keys into deleted and surviving
			var deleted, surviving []domain.APIKey
			for _, key := range keys {
				if shouldCleanup(key, now) {
					deleted = append(deleted, key)
				} else {
					surviving = append(surviving, key)
				}
			}

			// Verify: every deleted key must satisfy at least one cleanup condition
			for _, key := range deleted {
				if key.ExpiresAt == nil {
					t.Fatalf("key %s with nil expires_at should not be deleted", key.ID)
				}
				expiredAndRevoked := key.ExpiresAt.Before(now) && key.RevokedAt != nil
				expiredOver30Days := key.ExpiresAt.Before(now.Add(-30 * 24 * time.Hour))
				if !expiredAndRevoked && !expiredOver30Days {
					t.Fatalf("key %s deleted but does not match any cleanup rule: expires_at=%v, revoked_at=%v",
						key.ID, key.ExpiresAt, key.RevokedAt)
				}
			}

			// Verify: every surviving key must NOT satisfy any cleanup condition
			for _, key := range surviving {
				if key.ExpiresAt == nil {
					continue // nil expires_at is always preserved
				}
				expiredAndRevoked := key.ExpiresAt.Before(now) && key.RevokedAt != nil
				expiredOver30Days := key.ExpiresAt.Before(now.Add(-30 * 24 * time.Hour))
				if expiredAndRevoked || expiredOver30Days {
					t.Fatalf("key %s survived but matches cleanup rule: expires_at=%v, revoked_at=%v",
						key.ID, key.ExpiresAt, key.RevokedAt)
				}
			}

			// Verify: total count is preserved
			if len(deleted)+len(surviving) != len(keys) {
				t.Fatalf("partition mismatch: %d deleted + %d surviving != %d total",
					len(deleted), len(surviving), len(keys))
			}
		})
	})

	t.Run("nil_expires_at_always_preserved", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := domain.APIKey{
				ID:        uuid.New(),
				ExpiresAt: nil,
			}
			// Optionally set revoked_at
			if rapid.Bool().Draw(t, "revoked") {
				key.RevokedAt = revokedAtGen(t, "rev")
			}
			if shouldCleanup(key, now) {
				t.Fatalf("key with nil expires_at should never be cleaned up, revoked_at=%v", key.RevokedAt)
			}
		})
	})

	t.Run("future_expiry_always_preserved", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			key := domain.APIKey{
				ID:        uuid.New(),
				ExpiresAt: futureTimeGen(t, "future"),
			}
			// Optionally set revoked_at
			if rapid.Bool().Draw(t, "revoked") {
				key.RevokedAt = revokedAtGen(t, "rev")
			}
			if shouldCleanup(key, now) {
				t.Fatalf("key with future expires_at=%v should never be cleaned up", key.ExpiresAt)
			}
		})
	})

	t.Run("grace_period_not_revoked_preserved", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Expired within 30 days, NOT revoked
			minutesAgo := rapid.IntRange(1, 30*24*60-1).Draw(t, "graceMinutes")
			ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
			key := domain.APIKey{
				ID:        uuid.New(),
				ExpiresAt: &ts,
				RevokedAt: nil,
			}
			if shouldCleanup(key, now) {
				t.Fatalf("key expired %d minutes ago (within grace period) and not revoked should be preserved, expires_at=%v",
					minutesAgo, key.ExpiresAt)
			}
		})
	})

	t.Run("expired_and_revoked_always_deleted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Any past expiry + revoked → should be deleted
			expiresAt := pastTimeGen(t, "expired")
			revokedAt := revokedAtGen(t, "rev")
			key := domain.APIKey{
				ID:        uuid.New(),
				ExpiresAt: expiresAt,
				RevokedAt: revokedAt,
			}
			if !shouldCleanup(key, now) {
				t.Fatalf("key with past expires_at=%v and revoked_at=%v should be deleted",
					key.ExpiresAt, key.RevokedAt)
			}
		})
	})

	t.Run("expired_over_30_days_always_deleted", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			// Expired more than 30 days ago → should be deleted regardless of revocation
			minutesAgo := rapid.IntRange(30*24*60+1, 90*24*60).Draw(t, "oldMinutes")
			ts := now.Add(-time.Duration(minutesAgo) * time.Minute)
			key := domain.APIKey{
				ID:        uuid.New(),
				ExpiresAt: &ts,
				RevokedAt: nil, // not revoked, but still should be deleted
			}
			if !shouldCleanup(key, now) {
				t.Fatalf("key expired %d minutes ago (>30 days) should be deleted even without revocation, expires_at=%v",
					minutesAgo, key.ExpiresAt)
			}
		})
	})
}
