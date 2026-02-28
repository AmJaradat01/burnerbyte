package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

type visitor struct {
	count    int
	resetAt  time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	cfg      config.RateLimitConfig
}

func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{visitors: make(map[string]*visitor), cfg: cfg}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) cleanup() {
	for {
		time.Sleep(5 * time.Minute)
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

func (rl *RateLimiter) allow(key string, limit int, window time.Duration) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	v, ok := rl.visitors[key]
	if !ok || now.After(v.resetAt) {
		rl.visitors[key] = &visitor{count: 1, resetAt: now.Add(window)}
		return true
	}
	v.count++
	return v.count <= limit
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
		} else {
			key = "ip:" + realIP(r)
			limit = rl.cfg.Unauthenticated
		}
		if limit <= 0 {
			limit = 60
		}
		if !rl.allow(key, limit, time.Minute) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// LoginLimiter returns middleware specifically for login endpoints.
func (rl *RateLimiter) LoginLimiter(next http.Handler) http.Handler {
	if !rl.cfg.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := "login:" + realIP(r)
		limit := rl.cfg.Login
		if limit <= 0 {
			limit = 5
		}
		if !rl.allow(key, limit, time.Minute) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"too many login attempts"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func realIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.SplitN(xff, ",", 2)[0]
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// Strip port
	addr := r.RemoteAddr
	if i := strings.LastIndex(addr, ":"); i != -1 {
		return addr[:i]
	}
	return addr
}
