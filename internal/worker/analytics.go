package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

func AnalyticsJob(analyticsRepo *postgres.AnalyticsRepo, rdb *redis.Client, cacheTTL time.Duration) func(ctx context.Context) error {
	if cacheTTL <= 0 {
		cacheTTL = 2 * time.Hour
	}
	return func(ctx context.Context) error {
		stats, err := analyticsRepo.GetSystemStats(ctx)
		if err != nil {
			return err
		}
		data, err := json.Marshal(stats)
		if err != nil {
			return err
		}
		if err := rdb.Set(ctx, "bb:analytics:system_stats", data, cacheTTL).Err(); err != nil {
			slog.Error("analytics cache write failed", "error", err)
			return err
		}
		slog.Debug("analytics stats cached")
		return nil
	}
}
