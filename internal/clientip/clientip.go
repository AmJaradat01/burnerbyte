package clientip

import (
	"context"
	"net"
	"net/http"
	"strings"
)

// Replaces chi's middleware.RealIP, which rewrote r.RemoteAddr from
// True-Client-IP / X-Real-IP / X-Forwarded-For with no trusted-proxy check —
// chi's own documentation warns against using it without a reverse proxy, and
// it carries three IP-spoofing advisories (GO-2026-5774/5775/5777).
//
// Because it ran second in the global chain, every downstream consumer of
// r.RemoteAddr read a value the client chose: the /metrics loopback gate, the
// rate limiters, the per-key API-key IP allowlist and the audit trail's source
// IP. The rate limiter's own trusted-proxy logic was already correct but never
// got the chance to run.
//
// The resolution now happens once, respecting the trusted-proxy list, and is
// carried in the request context. r.RemoteAddr is left as the kernel reported
// it, so a handler that reads it directly gets the true peer rather than a
// forged one.

type clientIPKey struct{}

// extractIP strips the port from a RemoteAddr, tolerating an address that
// carries none.
func extractIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

// Resolver resolves the client IP for a request, trusting forwarded
// headers only when the immediate peer is a configured proxy. With no trusted
// proxies configured (the default) it always reports the peer address, which
// is the correct answer for a directly-exposed deployment.
type Resolver struct {
	trustedNets []*net.IPNet
}

// New builds a resolver from a list of proxy CIDRs. A bare
// address is treated as a single host. Unparseable entries are skipped.
func New(trustedProxies []string) *Resolver {
	return &Resolver{trustedNets: parseTrustedNets(trustedProxies)}
}

func parseTrustedNets(trustedProxies []string) []*net.IPNet {
	var nets []*net.IPNet
	for _, cidr := range trustedProxies {
		if !strings.Contains(cidr, "/") {
			if ip := net.ParseIP(cidr); ip != nil && ip.To4() == nil {
				cidr += "/128"
			} else {
				cidr += "/32"
			}
		}
		if _, ipNet, err := net.ParseCIDR(cidr); err == nil {
			nets = append(nets, ipNet)
		}
	}
	return nets
}

func (c *Resolver) isTrusted(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, n := range c.trustedNets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

// Resolve returns the client IP for the request.
func (c *Resolver) Resolve(r *http.Request) string {
	peer := extractIP(r.RemoteAddr)
	if len(c.trustedNets) == 0 || !c.isTrusted(peer) {
		return peer
	}
	// The rightmost X-Forwarded-For entry is the one our own trusted proxy
	// appended; entries to its left were supplied by the client or by
	// upstream proxies we know nothing about.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" && net.ParseIP(xri) != nil {
		return xri
	}
	return peer
}

// Middleware stores the resolved client IP in the request context so that
// handlers, the audit recorder and the auth middleware all agree on it
// without each re-deriving it from headers.
func (c *Resolver) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), clientIPKey{}, c.Resolve(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// From returns the resolved client IP for a request. It falls back to the
// peer address when the resolver middleware is not installed (unit tests,
// the SMTP daemon), so callers never have to special-case a missing value.
func From(r *http.Request) string {
	if ip, ok := FromContext(r.Context()); ok {
		return ip
	}
	return extractIP(r.RemoteAddr)
}

// FromContext reports the resolved client IP and whether the resolver
// middleware actually set one.
func FromContext(ctx context.Context) (string, bool) {
	ip, ok := ctx.Value(clientIPKey{}).(string)
	return ip, ok && ip != ""
}

// With injects a resolved client IP, for tests and for callers that
// build a request outside the middleware chain.
func With(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, clientIPKey{}, ip)
}
