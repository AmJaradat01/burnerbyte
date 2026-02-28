package config

import (
	"context"
	"log/slog"
)

// SystemConfigLoader loads runtime configs from the database.
type SystemConfigLoader interface {
	Get(ctx context.Context, key string, dest any) error
}

// LoadFromDB overrides in-memory config with values stored in system_configs table.
// Called on startup after DB is connected. Missing keys are silently skipped.
func (c *Config) LoadFromDB(ctx context.Context, repo SystemConfigLoader) {
	var mailer MailerConfig
	if err := repo.Get(ctx, "mailer", &mailer); err == nil {
		c.Mailer = mailer
		slog.Info("loaded mailer config from database")
	}

	var storage MinIOConfig
	if err := repo.Get(ctx, "storage", &storage); err == nil {
		c.MinIO = storage
		slog.Info("loaded storage config from database")
	}
}
