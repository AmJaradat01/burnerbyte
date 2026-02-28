package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/config"
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
}

// NewRateLimiter creates a rate limiter and starts a background cleanup goroutine.
// Call Stop() to release the goroutine.
func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	ctx, cancel := context.WithCancel(context.Background())
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		cfg:      cfg,
		cancel:   cancel,
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
			key = "ip:" + RealIP(r)
			limit = rl.cfg.Unauthenticated
			if limit <= 0 {
				limit = 20
			}
		}
		allowed, remaining, resetUnix := rl.allow(key, limit, time.Minute)
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
		key := "login:" + RealIP(r)
		limit := rl.cfg.Login
		if limit <= 0 {
			limit = 5
		}
		allowed, remaining, resetUnix := rl.allow(key, limit, time.Minute)
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
		key := "forgot:" + RealIP(r)
		limit := rl.cfg.ForgotPassword
		if limit <= 0 {
			limit = 3
		}
		allowed, remaining, resetUnix := rl.allow(key, limit, time.Hour)
		writeRateLimitHeaders(w, limit, remaining, resetUnix)
		if !allowed {
			rejectRateLimit(w, limit, resetUnix)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RealIP extracts the client IP from the request, respecting X-Forwarded-For
// and X-Real-IP headers. Handles IPv6 bracket notation.
func RealIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first (leftmost) IP — the original client
		ip := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
		if ip != "" {
			return ip
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	// net.SplitHostPort handles both IPv4 "1.2.3.4:port" and IPv6 "[::1]:port"
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
