package config

import (
	"strings"
	"sync"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	MinIO    MinIOConfig    `mapstructure:"minio"`
	JWT      JWTConfig      `mapstructure:"jwt"`
	SMTP     SMTPConfig     `mapstructure:"smtp"`
	Mailer   MailerConfig   `mapstructure:"mailer"`
	SSO      SSOConfig      `mapstructure:"sso"`
	CORS     CORSConfig     `mapstructure:"cors"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
	Lockout  LockoutConfig  `mapstructure:"lockout"`
	Password PasswordConfig `mapstructure:"password_policy"`
	Defaults DefaultsConfig `mapstructure:"defaults"`
	EmailVerification EmailVerificationConfig `mapstructure:"email_verification"`
	Logging  LoggingConfig  `mapstructure:"logging"`
	Metrics  MetricsConfig  `mapstructure:"metrics"`
	Workers  WorkersConfig  `mapstructure:"workers"`
	Encryption EncryptionConfig `mapstructure:"encryption"`
	Demo     DemoConfig     `mapstructure:"demo"`

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
	Endpoint  string `mapstructure:"endpoint"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	Bucket    string `mapstructure:"bucket"`
	UseSSL    bool   `mapstructure:"use_ssl"`
}

type JWTConfig struct {
	Secret     string        `mapstructure:"secret"`
	AccessTTL  time.Duration `mapstructure:"access_ttl"`
	RefreshTTL time.Duration `mapstructure:"refresh_ttl"`
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
	AttachmentsEnabled  bool          `mapstructure:"attachments_enabled"`
	AllowRegistration   bool          `mapstructure:"allow_registration"`
	DefaultInboxTTL     time.Duration `mapstructure:"default_inbox_ttl"`
	MaxInboxTTL         time.Duration `mapstructure:"max_inbox_ttl"`
	MaxAttachmentSizeMB int           `mapstructure:"max_attachment_size_mb"`
	MaxDomains          int           `mapstructure:"max_domains"`
	MaxTeams            int           `mapstructure:"max_teams"`
	MaxInboxesPerDomain int           `mapstructure:"max_inboxes_per_domain"`
	EnforceSSO          bool          `mapstructure:"enforce_sso"`
	PasswordResetTTL    time.Duration `mapstructure:"password_reset_ttl"`
	InviteExpiryTTL     time.Duration `mapstructure:"invite_expiry_ttl"`
	PresignedURLTTL     time.Duration `mapstructure:"presigned_url_ttl"`
	WebhookTimeout      time.Duration `mapstructure:"webhook_timeout"`
	WebhookMaxRetries   int           `mapstructure:"webhook_max_retries"`
	AnalyticsCacheTTL   time.Duration `mapstructure:"analytics_cache_ttl"`
	AnalyticsDefaultDays int          `mapstructure:"analytics_default_days"`
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

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("/etc/burnerbyte")

	v.SetEnvPrefix("BB")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Defaults
	v.SetDefault("defaults.max_sessions_per_user", 5)

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
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
