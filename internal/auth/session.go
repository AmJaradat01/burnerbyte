package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Lockout tracks failed login attempts in Redis and enforces account lockout.
type Lockout struct {
	rdb         *redis.Client
	maxAttempts int
	duration    time.Duration
}

func NewLockout(rdb *redis.Client, maxAttempts int, duration time.Duration) *Lockout {
	return &Lockout{rdb: rdb, maxAttempts: maxAttempts, duration: duration}
}

func (l *Lockout) keyAttempts(userID uuid.UUID) string {
	return fmt.Sprintf("lockout:attempts:%s", userID)
}

func (l *Lockout) keyLocked(userID uuid.UUID) string {
	return fmt.Sprintf("lockout:locked:%s", userID)
}

func (l *Lockout) IsLocked(ctx context.Context, userID uuid.UUID) (bool, time.Duration, error) {
	ttl, err := l.rdb.TTL(ctx, l.keyLocked(userID)).Result()
	if err != nil {
		return false, 0, err
	}
	if ttl > 0 {
		return true, ttl, nil
	}
	return false, 0, nil
}

func (l *Lockout) RecordFailure(ctx context.Context, userID uuid.UUID) (locked bool, err error) {
	key := l.keyAttempts(userID)
	count, err := l.rdb.Incr(ctx, key).Result()
	if err != nil {
		return false, err
	}

	// Set expiry on first attempt
	if count == 1 {
		l.rdb.Expire(ctx, key, l.duration)
	}

	if int(count) >= l.maxAttempts {
		l.rdb.Set(ctx, l.keyLocked(userID), "1", l.duration)
		l.rdb.Del(ctx, key)
		return true, nil
	}

	return false, nil
}

func (l *Lockout) Reset(ctx context.Context, userID uuid.UUID) error {
	pipe := l.rdb.Pipeline()
	pipe.Del(ctx, l.keyAttempts(userID))
	pipe.Del(ctx, l.keyLocked(userID))
	_, err := pipe.Exec(ctx)
	return err
}
