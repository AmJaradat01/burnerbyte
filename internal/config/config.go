package config

import (
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server            ServerConfig            `mapstructure:"server"`
	Database          DatabaseConfig          `mapstructure:"database"`
	Redis             RedisConfig             `mapstructure:"redis"`
	MinIO             MinIOConfig             `mapstructure:"minio"`
	JWT               JWTConfig               `mapstructure:"jwt"`
	SMTP              SMTPConfig              `mapstructure:"smtp"`
	Mailer            MailerConfig            `mapstructure:"mailer"`
	SSO               SSOConfig               `mapstructure:"sso"`
	CORS              CORSConfig              `mapstructure:"cors"`
	RateLimit         RateLimitConfig         `mapstructure:"rate_limit"`
	Lockout           LockoutConfig           `mapstructure:"lockout"`
	Password          PasswordConfig          `mapstructure:"password_policy"`
	Defaults          DefaultsConfig          `mapstructure:"defaults"`
	EmailVerification EmailVerificationConfig `mapstructure:"email_verification"`
	Logging           LoggingConfig           `mapstructure:"logging"`
	Metrics           MetricsConfig           `mapstructure:"metrics"`
	Workers           WorkersConfig           `mapstructure:"workers"`
	Encryption        EncryptionConfig        `mapstructure:"encryption"`
	Demo              DemoConfig              `mapstructure:"demo"`
	AuthCookie        CookieConfig            `mapstructure:"auth_cookie"`

	// mu guards the runtime-mutable settings groups (Password, Lockout,
	// Defaults, EmailVerification) that PUT /admin/platform updates while
	// request handlers and services read them concurrently. Readers must use
	// the accessors below; the writer applies changes via WriteLocked.
	mu sync.RWMutex
}

// PasswordPolicy returns a consistent snapshot of the password policy.
func (c *Config) PasswordPolicy() PasswordConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Password
}

// LockoutPolicy returns a consistent snapshot of the account-lockout policy.
func (c *Config) LockoutPolicy() LockoutConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Lockout
}

// RuntimeDefaults returns a consistent snapshot of the defaults/limits group.
func (c *Config) RuntimeDefaults() DefaultsConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Defaults
}

// EmailVerificationEnabled reports whether new users must verify their email.
func (c *Config) EmailVerificationEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.EmailVerification.Enabled
}

// DemoEnabled reports whether the public demo (try-it) inbox is active.
func (c *Config) DemoEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Demo.Enabled
}

// DemoConfigured reports whether the demo assignment/user IDs are set. The
// admin toggle has no effect until they are, so the UI surfaces this.
func (c *Config) DemoConfigured() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Demo.AssignmentID != "" && c.Demo.UserID != ""
}

// WriteLocked applies fn under the write lock so the runtime-mutable groups
// update atomically with respect to readers. fn must not call the read
// accessors above, as it already holds the lock.
func (c *Config) WriteLocked(fn func(*Config)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fn(c)
}

// EncryptionConfig holds the key for encrypting sensitive data at rest (DB).
type EncryptionConfig struct {
	// Key must be exactly 32 bytes (hex-encoded = 64 chars) for AES-256-GCM.
	Key string `mapstructure:"key"`
}

// DemoConfig powers the public "try it" inbox on the landing page. Off by
// default: the public endpoints only activate when Enabled is true and a demo
// AssignmentID + UserID (provisioned by the operator) are set. Demo inboxes are
// created under that user/assignment with a short TTL.
type DemoConfig struct {
	Enabled      bool          `mapstructure:"enabled"`
	AssignmentID string        `mapstructure:"assignment_id"`
	UserID       string        `mapstructure:"user_id"`
	TTL          time.Duration `mapstructure:"ttl"`
}

type ServerConfig struct {
	Port            int           `mapstructure:"port"`
	BaseURL         string        `mapstructure:"base_url"`
	FrontendURL     string        `mapstructure:"frontend_url"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	IdleTimeout     time.Duration `mapstructure:"idle_timeout"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
	MaxBodySize     int64         `mapstructure:"max_body_size"`
}

type DatabaseConfig struct {
	URL             string        `mapstructure:"url"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
}

type RedisConfig struct {
	URL        string `mapstructure:"url"`
	MaxRetries int    `mapstructure:"max_retries"`
}

type MinIOConfig struct {
	// json tags must match the keys persisted in system_config ("storage"), set
	// by the setup wizard and the admin storage editor. Without them, LoadFromDB's
	// json.Unmarshal silently drops AccessKey/SecretKey/UseSSL (the underscore keys
	// do not case-fold to the Go field names), so DB-stored storage credentials
	// would load empty at boot.
	Endpoint  string `mapstructure:"endpoint" json:"endpoint"`
	AccessKey string `mapstructure:"access_key" json:"access_key"`
	SecretKey string `mapstructure:"secret_key" json:"secret_key"`
	Bucket    string `mapstructure:"bucket" json:"bucket"`
	UseSSL    bool   `mapstructure:"use_ssl" json:"use_ssl"`
}

type JWTConfig struct {
	Secret     string        `mapstructure:"secret"`
	AccessTTL  time.Duration `mapstructure:"access_ttl"`
	RefreshTTL time.Duration `mapstructure:"refresh_ttl"`
}

// CookieConfig controls the httpOnly refresh-token cookie issued to browser
// clients that opt into cookie mode on the auth endpoints.
type CookieConfig struct {
	// SameSite is "lax" (default), "strict", or "none". Use "none" only when
	// the frontend and API are served from unrelated domains; it forces the
	// Secure attribute, so it requires HTTPS.
	SameSite string `mapstructure:"same_site"`
}

type SMTPConfig struct {
	Listen    string `mapstructure:"listen"`
	Hostname  string `mapstructure:"hostname"`
	MaxSize   int64  `mapstructure:"max_size"`
	QueueSize int    `mapstructure:"queue_size"`
	Workers   int    `mapstructure:"workers"`
	TLSCert   string `mapstructure:"tls_cert"`
	TLSKey    string `mapstructure:"tls_key"`
}

type MailerConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
	From     string `mapstructure:"from"`
	TLS      bool   `mapstructure:"tls"`
}

type SSOConfig struct {
	Provider     string `mapstructure:"provider" json:"provider"`
	ClientID     string `mapstructure:"client_id" json:"client_id"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url" json:"redirect_url"`
	TenantID     string `mapstructure:"tenant_id" json:"tenant_id,omitempty"`
	IssuerURL    string `mapstructure:"issuer_url" json:"issuer_url,omitempty"`
	// Auto-provisioning
	AutoProvision   bool   `mapstructure:"auto_provision" json:"auto_provision"`
	DefaultOrgRole  string `mapstructure:"default_org_role" json:"default_org_role,omitempty"`
	DefaultTeamRole string `mapstructure:"default_team_role" json:"default_team_role,omitempty"`
	AllowedDomains  string `mapstructure:"allowed_domains" json:"allowed_domains,omitempty"` // comma-separated
}

type CORSConfig struct {
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	AllowedMethods []string `mapstructure:"allowed_methods"`
	AllowedHeaders []string `mapstructure:"allowed_headers"`
	MaxAge         int      `mapstructure:"max_age"`
}

type RateLimitConfig struct {
	Enabled         bool     `mapstructure:"enabled"`
	Authenticated   int      `mapstructure:"authenticated"`
	Unauthenticated int      `mapstructure:"unauthenticated"`
	Login           int      `mapstructure:"login"`
	ForgotPassword  int      `mapstructure:"forgot_password"`
	TrustedProxies  []string `mapstructure:"trusted_proxies"`
}

type LockoutConfig struct {
	MaxAttempts int           `mapstructure:"max_attempts"`
	Duration    time.Duration `mapstructure:"duration"`
}

type PasswordConfig struct {
	MinLength        int  `mapstructure:"min_length"`
	RequireUppercase bool `mapstructure:"require_uppercase"`
	RequireLowercase bool `mapstructure:"require_lowercase"`
	RequireNumber    bool `mapstructure:"require_number"`
	RequireSpecial   bool `mapstructure:"require_special"`
	BcryptCost       int  `mapstructure:"bcrypt_cost"`
}

type DefaultsConfig struct {
	AttachmentsEnabled   bool          `mapstructure:"attachments_enabled"`
	AllowRegistration    bool          `mapstructure:"allow_registration"`
	DefaultInboxTTL      time.Duration `mapstructure:"default_inbox_ttl"`
	MaxInboxTTL          time.Duration `mapstructure:"max_inbox_ttl"`
	MaxAttachmentSizeMB  int           `mapstructure:"max_attachment_size_mb"`
	MaxDomains           int           `mapstructure:"max_domains"`
	MaxTeams             int           `mapstructure:"max_teams"`
	MaxInboxesPerDomain  int           `mapstructure:"max_inboxes_per_domain"`
	EnforceSSO           bool          `mapstructure:"enforce_sso"`
	PasswordResetTTL     time.Duration `mapstructure:"password_reset_ttl"`
	InviteExpiryTTL      time.Duration `mapstructure:"invite_expiry_ttl"`
	PresignedURLTTL      time.Duration `mapstructure:"presigned_url_ttl"`
	WebhookTimeout       time.Duration `mapstructure:"webhook_timeout"`
	WebhookMaxRetries    int           `mapstructure:"webhook_max_retries"`
	AnalyticsCacheTTL    time.Duration `mapstructure:"analytics_cache_ttl"`
	AnalyticsDefaultDays int           `mapstructure:"analytics_default_days"`
	Timezone             string        `mapstructure:"timezone"`
	DateFormat           string        `mapstructure:"date_format"`
	TimeFormat           string        `mapstructure:"time_format"`
	MaxSessionsPerUser   int           `mapstructure:"max_sessions_per_user"`
}

type EmailVerificationConfig struct {
	Enabled bool          `mapstructure:"enabled"`
	TTL     time.Duration `mapstructure:"ttl"`
}

type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

type MetricsConfig struct {
	Enabled bool   `mapstructure:"enabled"`
	Path    string `mapstructure:"path"`
}

type WorkersConfig struct {
	DNSRecheckInterval   time.Duration `mapstructure:"dns_recheck_interval"`
	CleanupInterval      time.Duration `mapstructure:"cleanup_interval"`
	WebhookRetryInterval time.Duration `mapstructure:"webhook_retry_interval"`
	ReconcilerInterval   time.Duration `mapstructure:"reconciler_interval"`
	AnalyticsInterval    time.Duration `mapstructure:"analytics_interval"`
}

func Load() (*Config, error) {
	v := viper.New()

	// An explicit BB_CONFIG_PATH wins (this is also where the first-run installer
	// writes, so write and read stay consistent); otherwise search the
	// conventional locations.
	if p := strings.TrimSpace(os.Getenv("BB_CONFIG_PATH")); p != "" {
		v.SetConfigFile(p)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("/etc/burnerbyte")
	}

	v.SetEnvPrefix("BB")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Defaults — mirror config.example.yaml so the binary is fully usable in an
	// env-only / 12-factor deployment (secrets + DATABASE_URL in the environment,
	// no config.yaml). This is also why every operational key is registered here:
	// viper's AutomaticEnv + Unmarshal only populate a nested key that is already
	// known to viper (via SetDefault, a config file, or BindEnv). An unregistered
	// nested key is silently left at its zero value, and any BB_* override for it
	// is ignored. A missing default is therefore not "use the documented value" —
	// it is 0/"" (e.g. a JWT TTL of 0 mints tokens that expire the instant they
	// are issued, and a max_inboxes_per_domain of 0 blocks all inbox creation).
	// DATABASE_URL / REDIS_URL / JWT_SECRET / ENCRYPTION_KEY are intentionally not
	// defaulted: they are deployment secrets bound to env and validated on boot.

	// Server
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.base_url", "http://localhost:8080")
	v.SetDefault("server.frontend_url", "http://localhost:3000")
	v.SetDefault("server.read_timeout", "30s")
	v.SetDefault("server.write_timeout", "30s")
	v.SetDefault("server.idle_timeout", "120s")
	v.SetDefault("server.shutdown_timeout", "15s")
	v.SetDefault("server.max_body_size", 1048576) // 1 MB

	// Connection pool — without these an env-only deployment fails on MaxSize=0.
	v.SetDefault("database.max_open_conns", 25)
	v.SetDefault("database.max_idle_conns", 5)
	v.SetDefault("database.conn_max_lifetime", "5m")
	v.SetDefault("redis.max_retries", 3)

	// JWT lifetimes — without these tokens carry exp == iat (expires_in: 0) and
	// every authenticated request is rejected the moment the token is minted.
	v.SetDefault("jwt.access_ttl", "15m")
	v.SetDefault("jwt.refresh_ttl", "168h")
	v.SetDefault("auth_cookie.same_site", "lax")

	// SMTP ingest (cmd/smtpd)
	v.SetDefault("smtp.listen", "0.0.0.0:2525")
	// hostname is announced in the 220 greeting and every HELO/EHLO reply, which
	// RFC 5321 requires to carry a domain. Left unregistered it unmarshalled to
	// "", emitting a malformed "220  ESMTP BurnerByte" that strict MTAs reject;
	// "localhost" is a valid placeholder that deployments override via
	// BB_SMTP_HOSTNAME (docker-compose sets it) or smtp.hostname in config.yaml.
	v.SetDefault("smtp.hostname", "localhost")
	v.SetDefault("smtp.max_size", 26214400) // 25 MB
	v.SetDefault("smtp.queue_size", 1000)
	v.SetDefault("smtp.workers", 4)
	v.SetDefault("smtp.tls_cert", "")
	v.SetDefault("smtp.tls_key", "")

	// Object storage (MinIO / S3-compatible). Registered purely so BB_MINIO_*
	// overrides are honoured: viper's AutomaticEnv ignores any BB_* value whose
	// nested key it does not already know, so before these were registered an
	// env-only deployment (docker-compose included) silently ran with an empty
	// endpoint and fell back to local-filesystem attachments. endpoint and the
	// credentials stay empty by default — an unset endpoint is the deliberate
	// signal to use local storage, and pointing it at localhost:9000 would turn
	// that into a dial timeout on every boot.
	v.SetDefault("minio.endpoint", "")
	v.SetDefault("minio.access_key", "")
	v.SetDefault("minio.secret_key", "")
	v.SetDefault("minio.bucket", "burnerbyte")
	v.SetDefault("minio.use_ssl", false)
	// Outbound mailer. host/username/password/from are deployment-specific and
	// stay empty, but they must still be registered: viper drops a BB_* override
	// for any nested key it does not already know, so .env.example's
	// BB_MAILER_HOST and friends were silently discarded and the only way to
	// configure the mailer was config.yaml or the setup wizard.
	v.SetDefault("mailer.host", "")
	v.SetDefault("mailer.port", 587)
	v.SetDefault("mailer.username", "")
	v.SetDefault("mailer.password", "")
	v.SetDefault("mailer.from", "")
	v.SetDefault("mailer.tls", true)

	// SSO/OIDC. Same reason as the mailer: the admin UI is the normal way to set
	// these (they persist to system_config and are overlaid at boot), but the
	// documented BB_SSO_* variables have to resolve for an env-only deployment.
	v.SetDefault("sso.provider", "")
	v.SetDefault("sso.client_id", "")
	v.SetDefault("sso.client_secret", "")
	v.SetDefault("sso.redirect_url", "")
	v.SetDefault("sso.tenant_id", "")
	v.SetDefault("sso.issuer_url", "")
	v.SetDefault("sso.auto_provision", false)
	v.SetDefault("sso.default_org_role", "")
	v.SetDefault("sso.default_team_role", "")
	v.SetDefault("sso.allowed_domains", "")

	// CORS
	v.SetDefault("cors.allowed_origins", []string{"http://localhost:3000"})
	v.SetDefault("cors.allowed_methods", []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"})
	v.SetDefault("cors.allowed_headers", []string{"Authorization", "Content-Type", "X-Request-ID"})
	v.SetDefault("cors.max_age", 86400)

	// Rate limiting (per minute)
	v.SetDefault("rate_limit.enabled", true)
	v.SetDefault("rate_limit.authenticated", 300)
	v.SetDefault("rate_limit.unauthenticated", 60)
	v.SetDefault("rate_limit.login", 10)
	v.SetDefault("rate_limit.forgot_password", 3)
	// CIDRs whose X-Forwarded-For is trusted for client-IP resolution.
	v.SetDefault("rate_limit.trusted_proxies", []string{})

	// Account lockout
	v.SetDefault("lockout.max_attempts", 5)
	v.SetDefault("lockout.duration", "15m")

	// Password policy
	v.SetDefault("password_policy.min_length", 8)
	v.SetDefault("password_policy.require_uppercase", true)
	v.SetDefault("password_policy.require_lowercase", true)
	v.SetDefault("password_policy.require_number", true)
	v.SetDefault("password_policy.require_special", true)
	// bcrypt.DefaultCost. auth.HashPassword already falls back to it when the
	// value is out of range, so this only makes BB_PASSWORD_POLICY_BCRYPT_COST
	// actually reachable.
	v.SetDefault("password_policy.bcrypt_cost", 10)

	// Platform defaults / limits
	v.SetDefault("defaults.attachments_enabled", true)
	v.SetDefault("defaults.allow_registration", true)
	v.SetDefault("defaults.default_inbox_ttl", "10m")
	v.SetDefault("defaults.max_inbox_ttl", "24h")
	v.SetDefault("defaults.max_attachment_size_mb", 25)
	v.SetDefault("defaults.max_domains", 10)
	v.SetDefault("defaults.max_teams", 50)
	v.SetDefault("defaults.max_inboxes_per_domain", 100)
	v.SetDefault("defaults.enforce_sso", false)
	v.SetDefault("defaults.max_sessions_per_user", 5)
	v.SetDefault("defaults.password_reset_ttl", "1h")
	v.SetDefault("defaults.invite_expiry_ttl", "48h")
	v.SetDefault("defaults.presigned_url_ttl", "15m")
	v.SetDefault("defaults.webhook_timeout", "10s")
	v.SetDefault("defaults.analytics_cache_ttl", "2h")
	// The consumers of these three already fall back when they read zero, so
	// registering them changes no behaviour — it only makes the documented
	// BB_DEFAULTS_* overrides take effect at all.
	v.SetDefault("defaults.webhook_max_retries", 3)
	v.SetDefault("defaults.analytics_default_days", 30)
	v.SetDefault("defaults.timezone", "UTC")
	v.SetDefault("defaults.date_format", "YYYY-MM-DD")
	v.SetDefault("defaults.time_format", "24h")

	v.SetDefault("email_verification.enabled", true)
	v.SetDefault("email_verification.ttl", "24h")

	// Logging / metrics
	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("metrics.enabled", true)
	v.SetDefault("metrics.path", "/metrics")

	// Background-worker intervals — unregistered they unmarshal to 0 and the
	// worker logs "invalid interval, skipping" instead of running.
	v.SetDefault("workers.dns_recheck_interval", "1h")
	v.SetDefault("workers.cleanup_interval", "5m")
	v.SetDefault("workers.webhook_retry_interval", "1m")
	v.SetDefault("workers.reconciler_interval", "1m")
	v.SetDefault("workers.analytics_interval", "5m")

	// Map specific env vars to config keys
	v.BindEnv("database.url", "DATABASE_URL")
	v.BindEnv("redis.url", "REDIS_URL")
	v.BindEnv("jwt.secret", "JWT_SECRET")
	// Bind explicitly: without it, viper's AutomaticEnv + Unmarshal won't pick up
	// this nested key in env-only deployments (no config file), silently leaving
	// credential encryption off and storing SSO/SMTP/storage secrets in plaintext.
	v.BindEnv("encryption.key", "ENCRYPTION_KEY")
	v.BindEnv("demo.enabled", "DEMO_ENABLED")
	v.BindEnv("demo.assignment_id", "DEMO_ASSIGNMENT_ID")
	v.BindEnv("demo.user_id", "DEMO_USER_ID")
	v.BindEnv("demo.ttl", "DEMO_TTL")
	v.BindEnv("server.port", "API_PORT")
	v.BindEnv("server.base_url", "API_BASE_URL")
	v.BindEnv("server.frontend_url", "FRONTEND_URL")
	v.BindEnv("logging.level", "LOG_LEVEL")
	v.BindEnv("logging.format", "LOG_FORMAT")

	if err := v.ReadInConfig(); err != nil {
		// A missing config file is fine: env + defaults drive the config, and the
		// first-run installer writes one. Tolerate both the search-path "not found"
		// and an explicit BB_CONFIG_PATH that does not exist yet (first boot).
		_, notFound := err.(viper.ConfigFileNotFoundError)
		if !notFound && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
