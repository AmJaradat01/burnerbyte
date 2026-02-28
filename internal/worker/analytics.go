package worker

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

func AnalyticsJob(analyticsRepo *postgres.AnalyticsRepo, rdb *redis.Client) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		stats, err := analyticsRepo.GetSystemStats(ctx)
		if err != nil {
			return err
		}
		data, err := json.Marshal(stats)
		if err != nil {
			return err
		}
		if err := rdb.Set(ctx, "bb:analytics:system_stats", data, 2*time.Hour).Err(); err != nil {
			slog.Error("analytics cache write failed", "error", err)
			return err
		}
		slog.Debug("analytics stats cached")
		return nil
	}
}
