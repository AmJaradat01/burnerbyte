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
		next.ServeHTTP(w, r)
	})
}
