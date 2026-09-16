package middleware

import "net/http"

// SecurityHeaders sets baseline security headers on every API response. The SPA
// configures its own headers in next.config; this hardens the API surface,
// which serves auth tokens and private data as JSON plus the Swagger /docs HTML.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// API responses carry access/refresh tokens and private email data;
		// keep them out of browser and intermediary caches.
		h.Set("Cache-Control", "no-store")
		// Block MIME-type sniffing of responses.
		h.Set("X-Content-Type-Options", "nosniff")
		// The API isn't meant to be framed (defends the Swagger /docs HTML
		// against clickjacking; harmless on JSON).
		h.Set("X-Frame-Options", "DENY")
		// Don't leak full request URLs (which may carry ?sso_code=, ?token=)
		// to cross-origin destinations.
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// The API serves JSON plus the Swagger /docs page. Nothing here needs
		// to load a script, frame anything or submit a form off-origin, so
		// lock it down; the SPA sets its own, looser policy in next.config.
		h.Set("Content-Security-Policy",
			"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; "+
				"script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "+
				"font-src 'self' data:; connect-src 'self'")
		// Only over a connection that is already TLS. Sending HSTS over plain
		// HTTP is ignored by browsers, and self-hosted deployments on a
		// plain-HTTP LAN address must not be pinned to a scheme they do not
		// serve.
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}
