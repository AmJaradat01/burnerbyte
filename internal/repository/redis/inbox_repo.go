package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type InboxRepo struct {
	rdb *redis.Client
}

func NewInboxRepo(rdb *redis.Client) *InboxRepo {
	return &InboxRepo{rdb: rdb}
}

func inboxKey(fullAddress string) string {
	return fmt.Sprintf("inbox:%s", fullAddress)
}

// Set stores an inbox mapping in Redis with TTL for fast SMTP lookups.
// Value is the inbox UUID.
func (r *InboxRepo) Set(ctx context.Context, fullAddress, inboxID string, ttl time.Duration) error {
	return r.rdb.Set(ctx, inboxKey(fullAddress), inboxID, ttl).Err()
}

// Get returns the inbox UUID for a full address, or empty string if not found.
func (r *InboxRepo) Get(ctx context.Context, fullAddress string) (string, error) {
	val, err := r.rdb.Get(ctx, inboxKey(fullAddress)).Result()
	if err == redis.Nil {
		return "", nil
	}
	return val, err
}

// Delete removes an inbox key from Redis.
func (r *InboxRepo) Delete(ctx context.Context, fullAddress string) error {
	return r.rdb.Del(ctx, inboxKey(fullAddress)).Err()
}
