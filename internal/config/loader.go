package config

import (
	"context"
	"log/slog"
	"time"
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

	var sso SSOConfig
	if err := repo.Get(ctx, "sso", &sso); err == nil {
		c.SSO = sso
		slog.Info("loaded sso config from database")
	}

	var platform struct {
		AllowRegistration    bool   `json:"allow_registration"`
		EmailVerification    bool   `json:"email_verification"`
		PasswordMinLength    int    `json:"password_min_length"`
		PasswordRequireUpper bool   `json:"password_require_upper"`
		PasswordRequireLower bool   `json:"password_require_lower"`
		PasswordRequireNum   bool   `json:"password_require_number"`
		PasswordRequireSpec  bool   `json:"password_require_special"`
		LockoutMaxAttempts   int    `json:"lockout_max_attempts"`
		LockoutDurationMins  int    `json:"lockout_duration_mins"`
		Timezone             string `json:"timezone"`
		DateFormat           string `json:"date_format"`
		TimeFormat           string `json:"time_format"`
		DefaultInboxTTL      string `json:"default_inbox_ttl"`
		MaxInboxTTL          string `json:"max_inbox_ttl"`
		MaxAttachmentSizeMB  int    `json:"max_attachment_size_mb"`
		MaxDomains           int    `json:"max_domains"`
		MaxTeams             int    `json:"max_teams"`
		MaxInboxesPerDomain  int    `json:"max_inboxes_per_domain"`
		MaxSessionsPerUser   int    `json:"max_sessions_per_user"`
	}
	if err := repo.Get(ctx, "platform", &platform); err == nil {
		c.Defaults.AllowRegistration = platform.AllowRegistration
		c.EmailVerification.Enabled = platform.EmailVerification
		if platform.PasswordMinLength > 0 {
			c.Password.MinLength = platform.PasswordMinLength
		}
		c.Password.RequireUppercase = platform.PasswordRequireUpper
		c.Password.RequireLowercase = platform.PasswordRequireLower
		c.Password.RequireNumber = platform.PasswordRequireNum
		c.Password.RequireSpecial = platform.PasswordRequireSpec
		if platform.LockoutMaxAttempts > 0 {
			c.Lockout.MaxAttempts = platform.LockoutMaxAttempts
		}
		if platform.LockoutDurationMins > 0 {
			c.Lockout.Duration = time.Duration(platform.LockoutDurationMins) * time.Minute
		}
		c.Defaults.Timezone = platform.Timezone
		c.Defaults.DateFormat = platform.DateFormat
		c.Defaults.TimeFormat = platform.TimeFormat
		if d, err := time.ParseDuration(platform.DefaultInboxTTL); err == nil && d > 0 {
			c.Defaults.DefaultInboxTTL = d
		}
		if d, err := time.ParseDuration(platform.MaxInboxTTL); err == nil && d > 0 {
			c.Defaults.MaxInboxTTL = d
		}
		if platform.MaxAttachmentSizeMB > 0 {
			c.Defaults.MaxAttachmentSizeMB = platform.MaxAttachmentSizeMB
		}
		if platform.MaxDomains > 0 {
			c.Defaults.MaxDomains = platform.MaxDomains
		}
		if platform.MaxTeams > 0 {
			c.Defaults.MaxTeams = platform.MaxTeams
		}
		if platform.MaxInboxesPerDomain > 0 {
			c.Defaults.MaxInboxesPerDomain = platform.MaxInboxesPerDomain
		}
		if platform.MaxSessionsPerUser > 0 {
			c.Defaults.MaxSessionsPerUser = platform.MaxSessionsPerUser
		}
		slog.Info("loaded platform config from database")
	}
}
