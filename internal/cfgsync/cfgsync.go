// Package cfgsync broadcasts runtime config-reload signals across processes
// (api and smtpd) over Redis pub/sub, so a config change made in one process
// (e.g. the admin storage editor in api) is applied live in the others without
// a restart.
package cfgsync

import (
	"context"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

// Channel is the Redis pub/sub channel carrying reload signals. The payload is
// the config key to reload (e.g. "storage").
const Channel = "burnerbyte:config:reload"

// Publish signals all subscribed processes to reload the given config key.
func Publish(ctx context.Context, rdb *redis.Client, key string) error {
	return rdb.Publish(ctx, Channel, key).Err()
}

// Subscribe starts a background loop that calls handle(key) for each reload
// message until ctx is cancelled. The publishing process also receives its own
// message, so handle must be idempotent.
func Subscribe(ctx context.Context, rdb *redis.Client, handle func(key string)) {
	sub := rdb.Subscribe(ctx, Channel)
	ch := sub.Channel()
	go func() {
		defer sub.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				handle(msg.Payload)
			}
		}
	}()
	slog.Info("config-reload subscriber started", "channel", Channel)
}
