package worker

import (
	"context"
	"log/slog"
	"time"

	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/amjaradat01/burnerbyte/internal/repository/redis"
)

func ReconcilerJob(inboxRepoPG *postgres.InboxRepo, inboxRepoRedis *redisrepo.InboxRepo) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Get all active inboxes from PG and ensure Redis keys exist
		// This is a simplified version — in production, batch with cursor pagination
		inboxes, _, err := inboxRepoPG.ListByUser(ctx, [16]byte{}, 1, 1000) // empty UUID gets nothing
		if err != nil {
			slog.Debug("reconciler: no inboxes to sync")
			return nil
		}
		synced := 0
		for _, inbox := range inboxes {
			remaining := time.Until(inbox.ExpiresAt)
			if remaining <= 0 { continue }
			existing, _ := inboxRepoRedis.Get(ctx, inbox.FullAddress)
			if existing == "" {
				inboxRepoRedis.Set(ctx, inbox.FullAddress, inbox.ID.String(), remaining)
				synced++
			}
		}
		if synced > 0 {
			slog.Info("reconciler synced", "count", synced)
		}
		return nil
	}
}
