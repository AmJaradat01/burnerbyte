package database

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

func NewRedis(ctx context.Context, cfg config.RedisConfig) (*redis.Client, error) {
	opts, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	opts.MaxRetries = cfg.MaxRetries

	client := redis.NewClient(opts)

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return client, nil
}
