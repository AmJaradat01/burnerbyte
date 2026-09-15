package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "github.com/amjaradat01/burnerbyte/internal/repository/redis"
)

func ReconcilerJob(inboxRepoPG *postgres.InboxRepo, inboxRepoRedis *redisrepo.InboxRepo) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		inboxes, err := inboxRepoPG.ListActive(ctx)
		if err != nil {
			return err
		}
		synced := 0
		for _, inbox := range inboxes {
			remaining := time.Until(inbox.ExpiresAt)
			if remaining <= 0 {
				continue
			}
			existing, _ := inboxRepoRedis.Get(ctx, inbox.FullAddress)
			if existing == "" {
				inboxRepoRedis.Set(ctx, inbox.FullAddress, inbox.ID.String(), remaining) //nolint:errcheck
				synced++
			}
		}
		if synced > 0 {
			slog.Info("reconciler synced", "count", synced)
		}
		return nil
	}
}
