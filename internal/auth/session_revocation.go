package auth

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// SessionRevocationCache tracks when a user's sessions were last revoked
// due to session limit enforcement. This allows the auth middleware to
// immediately reject access tokens that were issued before the revocation.
type SessionRevocationCache struct {
	rdb *redis.Client
	ttl time.Duration // should match access token TTL
}

func NewSessionRevocationCache(rdb *redis.Client, accessTTL time.Duration) *SessionRevocationCache {
	return &SessionRevocationCache{rdb: rdb, ttl: accessTTL}
}

func (c *SessionRevocationCache) key(userID uuid.UUID) string {
	return fmt.Sprintf("session_revoked_at:%s", userID)
}

// MarkRevoked records the current time as the revocation timestamp for a user.
// Access tokens issued before this time will be rejected by the middleware.
func (c *SessionRevocationCache) MarkRevoked(ctx context.Context, userID uuid.UUID) {
	_ = c.rdb.Set(ctx, c.key(userID), strconv.FormatInt(time.Now().Unix(), 10), c.ttl).Err()
}

// RevokedAt returns the Unix timestamp of the last session revocation for a user.
// Returns 0 if no revocation is recorded (or on error).
func (c *SessionRevocationCache) RevokedAt(ctx context.Context, userID uuid.UUID) int64 {
	val, err := c.rdb.Get(ctx, c.key(userID)).Result()
	if err != nil {
		return 0
	}
	ts, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0
	}
	return ts
}
