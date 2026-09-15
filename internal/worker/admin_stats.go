package worker

import (
	"context"
	"log/slog"

	"github.com/amjaradat01/burnerbyte/internal/realtime"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// AdminStatsJob periodically fetches system stats and broadcasts to connected admin WebSocket clients.
func AdminStatsJob(analyticsRepo *postgres.AnalyticsRepo, hub *realtime.AdminHub) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Only broadcast if there are connected clients
		if hub.ClientCount() == 0 {
			return nil
		}

		stats, err := analyticsRepo.GetSystemStats(ctx)
		if err != nil {
			slog.Error("admin stats broadcast: failed to get stats", "error", err)
			return nil // Don't fail the worker
		}

		hub.Broadcast(map[string]any{
			"type": "admin.stats",
			"data": stats,
		})

		return nil
	}
}
