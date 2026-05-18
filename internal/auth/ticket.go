package auth

import (
	"context"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisTicketResolver resolves one-time WebSocket tickets stored in Redis.
type RedisTicketResolver struct {
	rdb *redis.Client
}

func NewTicketResolver(rdb *redis.Client) *RedisTicketResolver {
	return &RedisTicketResolver{rdb: rdb}
}

func (r *RedisTicketResolver) Resolve(ctx context.Context, ticket string) (uuid.UUID, bool) {
	key := "ws_ticket:" + ticket
	val, err := r.rdb.GetDel(ctx, key).Result()
	if err != nil {
		return uuid.Nil, false
	}
	uid, err := uuid.Parse(val)
	if err != nil {
		return uuid.Nil, false
	}
	return uid, true
}
