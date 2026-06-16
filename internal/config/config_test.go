package config

import (
	"sync"
	"testing"
	"time"
)

// TestPlatformSettingsConcurrency exercises the runtime-mutable settings groups
// under concurrent reads (through the accessors) and writes (through
// WriteLocked) — the exact pattern of PUT /admin/platform racing with request
// handlers and services. Run with -race; correct synchronization must report
// no data race.
//
// Before the lock moved into Config, the platform handler mutated these fields
// in place while the services read them with no shared lock, which the race
// detector flags here if the accessors are bypassed.
func TestPlatformSettingsConcurrency(t *testing.T) {
	cfg := &Config{}
	// Single-threaded seed before any goroutine starts.
	cfg.Password.MinLength = 8
	cfg.Lockout.MaxAttempts = 5
	cfg.Defaults.MaxDomains = 10
	cfg.EmailVerification.Enabled = true

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Writer: applies new settings repeatedly under the write lock.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			cfg.WriteLocked(func(c *Config) {
				c.Password.MinLength = 8 + i%8
				c.Lockout.MaxAttempts = 1 + i%10
				c.Lockout.Duration = time.Duration(i) * time.Minute
				c.Defaults.MaxDomains = i % 100
				c.EmailVerification.Enabled = i%2 == 0
			})
		}
	}()

	// Readers: read every accessor concurrently with the writer.
	for r := 0; r < 8; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_ = cfg.PasswordPolicy().MinLength
				_ = cfg.LockoutPolicy().MaxAttempts
				_ = cfg.RuntimeDefaults().MaxDomains
				_ = cfg.EmailVerificationEnabled()
			}
		}()
	}

	time.Sleep(50 * time.Millisecond)
	close(stop)
	wg.Wait()
}

// TestEncryptionKeyEnvBinding simulates an env-only deployment (no config file)
// and asserts the encryption key loads from ENCRYPTION_KEY. Without the explicit
// BindEnv, viper's AutomaticEnv + Unmarshal does not populate this nested key
// from a bare (unprefixed) env var, which silently left credential encryption
// off and stored SSO/SMTP/storage secrets in plaintext.
func TestEncryptionKeyEnvBinding(t *testing.T) {
	const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	t.Setenv("ENCRYPTION_KEY", key)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}
	if cfg.Encryption.Key != key {
		t.Fatalf("encryption key not bound from ENCRYPTION_KEY: got %q, want it set", cfg.Encryption.Key)
	}
}

// TestEnvOnlyDefaults simulates a 12-factor deployment (secrets in env, no
// config.yaml — the test's working directory has none) and asserts the
// operational config loads with sane, non-zero defaults. Every key here is a
// nested viper key: before it was registered via SetDefault, Unmarshal left it
// at its zero value, which broke the running system in non-obvious ways. The
// canary is jwt.access_ttl — at 0 the auth service mints access tokens whose
// exp equals iat, so login "succeeds" (200, expires_in: 0) yet every subsequent
// authenticated request is rejected as expired.
func TestEnvOnlyDefaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.JWT.AccessTTL <= 0 {
		t.Errorf("jwt.access_ttl = %v, want > 0 (tokens would expire on issue)", cfg.JWT.AccessTTL)
	}
	if cfg.JWT.RefreshTTL <= 0 {
		t.Errorf("jwt.refresh_ttl = %v, want > 0", cfg.JWT.RefreshTTL)
	}
	if cfg.JWT.RefreshTTL <= cfg.JWT.AccessTTL {
		t.Errorf("refresh_ttl (%v) must outlast access_ttl (%v)", cfg.JWT.RefreshTTL, cfg.JWT.AccessTTL)
	}

	if cfg.Database.MaxOpenConns < 1 {
		t.Errorf("database.max_open_conns = %d, want >= 1 (pool fails to build at 0)", cfg.Database.MaxOpenConns)
	}

	if cfg.Defaults.DefaultInboxTTL <= 0 {
		t.Errorf("defaults.default_inbox_ttl = %v, want > 0", cfg.Defaults.DefaultInboxTTL)
	}
	if cfg.Defaults.MaxInboxTTL < cfg.Defaults.DefaultInboxTTL {
		t.Errorf("defaults.max_inbox_ttl (%v) must be >= default_inbox_ttl (%v)", cfg.Defaults.MaxInboxTTL, cfg.Defaults.DefaultInboxTTL)
	}
	if cfg.Defaults.MaxInboxesPerDomain < 1 {
		t.Errorf("defaults.max_inboxes_per_domain = %d, want >= 1 (0 blocks all inbox creation)", cfg.Defaults.MaxInboxesPerDomain)
	}
	if cfg.Defaults.MaxDomains < 1 {
		t.Errorf("defaults.max_domains = %d, want >= 1", cfg.Defaults.MaxDomains)
	}
	if cfg.Defaults.MaxSessionsPerUser < 1 {
		t.Errorf("defaults.max_sessions_per_user = %d, want >= 1", cfg.Defaults.MaxSessionsPerUser)
	}

	if cfg.Password.MinLength < 1 {
		t.Errorf("password_policy.min_length = %d, want >= 1", cfg.Password.MinLength)
	}
	if cfg.Lockout.MaxAttempts < 1 {
		t.Errorf("lockout.max_attempts = %d, want >= 1", cfg.Lockout.MaxAttempts)
	}

	if cfg.Server.Port == 0 {
		t.Errorf("server.port = 0, want a default listen port")
	}
	if cfg.Server.ReadTimeout <= 0 {
		t.Errorf("server.read_timeout = %v, want > 0", cfg.Server.ReadTimeout)
	}

	if cfg.Workers.CleanupInterval <= 0 {
		t.Errorf("workers.cleanup_interval = %v, want > 0 (worker would skip)", cfg.Workers.CleanupInterval)
	}
}
