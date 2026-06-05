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
