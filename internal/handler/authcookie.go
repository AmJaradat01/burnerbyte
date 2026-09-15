package handler

import (
	"net/http"
	"time"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

// Browser clients opt into cookie mode (use_cookie: true on the auth
// endpoints) to keep the refresh token out of JavaScript reach: it is stored
// only in this httpOnly cookie and omitted from JSON responses. API clients
// that never send the flag keep receiving the token in the body as before.
const (
	// refreshCookieName carries no __Host- prefix on purpose: self-hosted
	// deployments commonly run on plain-HTTP LAN addresses where the prefix's
	// mandatory Secure attribute would make browsers drop the cookie.
	refreshCookieName = "bb_refresh_token"
	// refreshCookiePath scopes the cookie to the auth endpoints so it is not
	// attached to regular API traffic.
	refreshCookiePath = "/api/v1/auth"
)

// requestIsHTTPS reports whether the client connection is HTTPS, looking
// through a TLS-terminating proxy via X-Forwarded-Proto (same convention as
// the SSO redirect flow).
func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// refreshCookieSameSite maps the configured policy to a SameSite mode and
// reports whether Secure must be forced: browsers reject SameSite=None
// cookies without it. "none" is the only mode that works when the API and
// frontend are served from unrelated domains.
func refreshCookieSameSite(cfg *config.Config) (http.SameSite, bool) {
	switch cfg.AuthCookie.SameSite {
	case "strict":
		return http.SameSiteStrictMode, false
	case "none":
		return http.SameSiteNoneMode, true
	default:
		return http.SameSiteLaxMode, false
	}
}

// setRefreshCookie stores the rotated refresh token for cookie-mode clients.
// The lifetime mirrors the refresh-token TTL so the cookie and the session it
// carries expire together.
func setRefreshCookie(w http.ResponseWriter, r *http.Request, cfg *config.Config, token string) {
	sameSite, forceSecure := refreshCookieSameSite(cfg)
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     refreshCookiePath,
		MaxAge:   int(cfg.JWT.RefreshTTL / time.Second),
		HttpOnly: true,
		SameSite: sameSite,
		Secure:   forceSecure || requestIsHTTPS(r),
	})
}

// clearRefreshCookie expires the refresh cookie. Attributes must match the
// ones used when setting it, or browsers keep the original cookie.
func clearRefreshCookie(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	sameSite, forceSecure := refreshCookieSameSite(cfg)
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: sameSite,
		Secure:   forceSecure || requestIsHTTPS(r),
	})
}

// refreshRequestToken returns the refresh token for the request and whether
// the response should operate in cookie mode. A body token takes precedence so
// legacy clients migrate cleanly: their stored token is consumed once and the
// rotated one lands in the cookie (when they ask for it via use_cookie).
// Without a body token, the httpOnly cookie implies cookie mode.
func refreshRequestToken(r *http.Request, bodyToken string, useCookie bool) (token string, cookieMode bool) {
	if bodyToken != "" {
		return bodyToken, useCookie
	}
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		return c.Value, true
	}
	return "", useCookie
}

// stripRefreshToken returns a copy of tokens without the refresh token, for
// cookie-mode responses where it travels only via Set-Cookie.
func stripRefreshToken(tokens *domain.TokenPair) *domain.TokenPair {
	if tokens == nil {
		return nil
	}
	stripped := *tokens
	stripped.RefreshToken = ""
	return &stripped
}
