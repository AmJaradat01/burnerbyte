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
