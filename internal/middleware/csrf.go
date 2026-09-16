package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

// The refresh cookie is httpOnly and scoped to /api/v1/auth, and under the
// default SameSite=Lax a browser will not attach it to a cross-site POST. But
// "none" is the documented setting for deployments where the API and the
// frontend sit on unrelated domains, and there it becomes forgeable: a page
// anywhere can POST to /auth/refresh or /auth/logout and the cookie rides
// along. CORS stops the attacker reading the response, so the damage is a
// forced token rotation or logout rather than a takeover — still worth
// closing, and an origin check costs nothing.
//
// Checking Origin rather than issuing a token keeps non-browser clients
// working: they send no Origin and are unaffected, and they authenticate with
// a bearer token that no browser will attach on their behalf anyway.

// SameOrigin rejects state-changing browser requests whose Origin is not in
// the allowed set. A request with no Origin header passes: that is a
// non-browser client, or a same-origin GET, neither of which can be forged
// cross-site the way a form post can.
func SameOrigin(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	wildcard := false
	for _, o := range allowedOrigins {
		if o == "*" {
			wildcard = true
			continue
		}
		allowed[strings.ToLower(strings.TrimRight(o, "/"))] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}

			origin := r.Header.Get("Origin")
			if origin == "" {
				// Fall back to Referer, which older browsers send when Origin
				// is absent. Still nothing? Treat as a non-browser client.
				if ref := r.Header.Get("Referer"); ref != "" {
					if u, err := url.Parse(ref); err == nil && u.Scheme != "" && u.Host != "" {
						origin = u.Scheme + "://" + u.Host
					}
				}
			}
			if origin == "" || wildcard {
				next.ServeHTTP(w, r)
				return
			}

			if !allowed[strings.ToLower(strings.TrimRight(origin, "/"))] {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"cross-origin request rejected"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
