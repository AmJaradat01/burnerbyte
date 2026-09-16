package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/clientip"
	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/redis/go-redis/v9"
)

type visitor struct {
	count   int
	resetAt time.Time
}

// RateLimiter implements a fixed-window rate limiter keyed by IP or user ID.
// It supports separate limits for authenticated, unauthenticated, login,
// and forgot-password requests. Expired entries are cleaned up periodically.
type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	cfg      config.RateLimitConfig
	cancel   context.CancelFunc
	clientIP *clientip.Resolver
	rdb      *redis.Client
}

// NewRateLimiter creates a rate limiter and starts a background cleanup goroutine.
// Call Stop() to release the goroutine.
func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	ctx, cancel := context.WithCancel(context.Background())

	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		cfg:      cfg,
		cancel:   cancel,
		clientIP: clientip.New(cfg.TrustedProxies),
	}
	go rl.cleanup(ctx)
	return rl
}

// Stop cancels the background cleanup goroutine.
func (rl *RateLimiter) Stop() {
	rl.cancel()
}

func (rl *RateLimiter) cleanup(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for k, v := range rl.visitors {
				if now.After(v.resetAt) {
					delete(rl.visitors, k)
				}
			}
			rl.mu.Unlock()
		}
	}
}

// allow checks whether the given key is within its rate limit for the given
// window. Returns (allowed, remaining, resetUnix).
func (rl *RateLimiter) allow(key string, limit int, window time.Duration) (bool, int, int64) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	v, ok := rl.visitors[key]
	if !ok || now.After(v.resetAt) {
		rl.visitors[key] = &visitor{count: 1, resetAt: now.Add(window)}
		return true, limit - 1, now.Add(window).Unix()
	}
	v.count++
	remaining := limit - v.count
	if remaining < 0 {
		remaining = 0
	}
	return v.count <= limit, remaining, v.resetAt.Unix()
}

// WithRedis enables Redis-based distributed rate limiting.
func (rl *RateLimiter) WithRedis(rdb *redis.Client) {
	rl.rdb = rdb
}

func (rl *RateLimiter) allowRedis(ctx context.Context, key string, limit int, window time.Duration) (bool, int, int64) {
	redisKey := "rl:" + key
	count, err := rl.rdb.Incr(ctx, redisKey).Result()
	if err != nil {
		return rl.allow(key, limit, window)
	}
	if count == 1 {
		rl.rdb.Expire(ctx, redisKey, window)
	}
	ttl, _ := rl.rdb.TTL(ctx, redisKey).Result()
	resetUnix := time.Now().Add(ttl).Unix()
	remaining := limit - int(count)
	if remaining < 0 {
		remaining = 0
	}
	return int(count) <= limit, remaining, resetUnix
}

func writeRateLimitHeaders(w http.ResponseWriter, limit, remaining int, resetUnix int64) {
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetUnix, 10))
}

func rejectRateLimit(w http.ResponseWriter, limit int, resetUnix int64) {
	writeRateLimitHeaders(w, limit, 0, resetUnix)
	retryAfter := resetUnix - time.Now().Unix()
	if retryAfter < 1 {
		retryAfter = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(retryAfter, 10))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	fmt.Fprintf(w, `{"error":"rate limit exceeded","retry_after":%d}`, retryAfter)
}

// Middleware returns a general rate limiter.
// Authenticated users are keyed by user ID, unauthenticated by IP.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	if !rl.cfg.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var key string
		var limit int
		uc := auth.GetUser(r.Context())
		if uc != nil {
			key = "user:" + uc.UserID.String()
			limit = rl.cfg.Authenticated
			if limit <= 0 {
				limit = 100
			}
		} else {
			key = "ip:" + rl.RealIP(r)
			limit = rl.cfg.Unauthenticated
			if limit <= 0 {
				limit = 20
			}
		}
		var allowed bool
		var remaining int
		var resetUnix int64
		if rl.rdb != nil {
			allowed, remaining, resetUnix = rl.allowRedis(r.Context(), key, limit, time.Minute)
		} else {
			allowed, remaining, resetUnix = rl.allow(key, limit, time.Minute)
		}
		writeRateLimitHeaders(w, limit, remaining, resetUnix)
		if !allowed {
			rejectRateLimit(w, limit, resetUnix)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// LoginLimiter returns middleware for login endpoints (per-IP, per-minute).
func (rl *RateLimiter) LoginLimiter(next http.Handler) http.Handler {
	if !rl.cfg.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "login:" + rl.RealIP(r)
		limit := rl.cfg.Login
		if limit <= 0 {
			limit = 5
		}
		var allowed bool
		var remaining int
		var resetUnix int64
		if rl.rdb != nil {
			allowed, remaining, resetUnix = rl.allowRedis(r.Context(), key, limit, time.Minute)
		} else {
			allowed, remaining, resetUnix = rl.allow(key, limit, time.Minute)
		}
		writeRateLimitHeaders(w, limit, remaining, resetUnix)
		if !allowed {
			rejectRateLimit(w, limit, resetUnix)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// DemoLimiter returns middleware for the public "try it" demo (per-IP,
// per-minute). More generous than LoginLimiter because the landing page polls a
// demo inbox for incoming mail; still bounded so it can't be abused for load.
func (rl *RateLimiter) DemoLimiter(next http.Handler) http.Handler {
	if !rl.cfg.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "demo:" + rl.RealIP(r)
		limit := 60
		var allowed bool
		var remaining int
		var resetUnix int64
		if rl.rdb != nil {
			allowed, remaining, resetUnix = rl.allowRedis(r.Context(), key, limit, time.Minute)
		} else {
			allowed, remaining, resetUnix = rl.allow(key, limit, time.Minute)
		}
		writeRateLimitHeaders(w, limit, remaining, resetUnix)
		if !allowed {
			rejectRateLimit(w, limit, resetUnix)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ForgotPasswordLimiter returns middleware for forgot-password (per-IP, per-hour).
func (rl *RateLimiter) ForgotPasswordLimiter(next http.Handler) http.Handler {
	if !rl.cfg.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "forgot:" + rl.RealIP(r)
		limit := rl.cfg.ForgotPassword
		if limit <= 0 {
			limit = 3
		}
		var allowed bool
		var remaining int
		var resetUnix int64
		if rl.rdb != nil {
			allowed, remaining, resetUnix = rl.allowRedis(r.Context(), key, limit, time.Hour)
		} else {
			allowed, remaining, resetUnix = rl.allow(key, limit, time.Hour)
		}
		writeRateLimitHeaders(w, limit, remaining, resetUnix)
		if !allowed {
			rejectRateLimit(w, limit, resetUnix)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RealIP extracts the client IP from RemoteAddr (no header trust).
func RealIP(r *http.Request) string {
	return extractIP(r.RemoteAddr)
}

// RealIP reports the client IP for rate-limit keying. It reads the value the
// clientip middleware already resolved, so the limiter, the audit trail and
// the API-key allowlist can never disagree about who the caller is.
func (rl *RateLimiter) RealIP(r *http.Request) string {
	if ip, ok := clientip.FromContext(r.Context()); ok {
		return ip
	}
	// No resolver middleware in the chain (unit tests, embedded use): resolve
	// with our own copy rather than silently ignoring trusted_proxies.
	return rl.clientIP.Resolve(r)
}

func extractIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}
