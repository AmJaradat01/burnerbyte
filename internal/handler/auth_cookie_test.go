package handler

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/domain"
)

func cookieCfg(sameSite string) *config.Config {
	return &config.Config{
		JWT:        config.JWTConfig{RefreshTTL: 7 * 24 * time.Hour},
		AuthCookie: config.CookieConfig{SameSite: sameSite},
	}
}

func refreshCookieFrom(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == refreshCookieName {
			return c
		}
	}
	t.Fatalf("response carries no %s cookie; Set-Cookie: %v", refreshCookieName, rec.Header().Values("Set-Cookie"))
	return nil
}

// TestSetRefreshCookie_Attributes verifies the security-relevant attributes
// the whole cookie design rests on: httpOnly (out of JavaScript reach), scoped
// to the auth path (not attached to regular API traffic), and a lifetime tied
// to the refresh-token TTL.
func TestSetRefreshCookie_Attributes(t *testing.T) {
	rec := httptest.NewRecorder()
	setRefreshCookie(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil), cookieCfg(""), "raw-token")

	c := refreshCookieFrom(t, rec)
	if c.Value != "raw-token" {
		t.Errorf("value: want raw-token, got %q", c.Value)
	}
	if !c.HttpOnly {
		t.Error("cookie must be HttpOnly")
	}
	if c.Path != refreshCookiePath {
		t.Errorf("path: want %s, got %s", refreshCookiePath, c.Path)
	}
	if want := int(7 * 24 * time.Hour / time.Second); c.MaxAge != want {
		t.Errorf("max-age: want %d (refresh TTL), got %d", want, c.MaxAge)
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("samesite: want Lax by default, got %v", c.SameSite)
	}
	if c.Secure {
		t.Error("secure must be off for plain-HTTP requests (LAN deployments)")
	}
}

// TestSetRefreshCookie_SameSitePolicies covers the config knob, including the
// browser rule that SameSite=None is only accepted with Secure.
func TestSetRefreshCookie_SameSitePolicies(t *testing.T) {
	cases := []struct {
		name       string
		configured string
		wantMode   http.SameSite
		wantSecure bool
	}{
		{"default empty -> lax", "", http.SameSiteLaxMode, false},
		{"lax", "lax", http.SameSiteLaxMode, false},
		{"strict", "strict", http.SameSiteStrictMode, false},
		{"none forces secure", "none", http.SameSiteNoneMode, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			setRefreshCookie(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil), cookieCfg(tc.configured), "tok")
			c := refreshCookieFrom(t, rec)
			if c.SameSite != tc.wantMode {
				t.Errorf("samesite: want %v, got %v", tc.wantMode, c.SameSite)
			}
			if c.Secure != tc.wantSecure {
				t.Errorf("secure: want %v, got %v", tc.wantSecure, c.Secure)
			}
		})
	}
}

// TestSetRefreshCookie_SecureOverHTTPS verifies Secure is derived from the
// actual connection: direct TLS and the X-Forwarded-Proto convention used
// behind TLS-terminating proxies.
func TestSetRefreshCookie_SecureOverHTTPS(t *testing.T) {
	t.Run("x-forwarded-proto", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		rec := httptest.NewRecorder()
		setRefreshCookie(rec, req, cookieCfg(""), "tok")
		if !refreshCookieFrom(t, rec).Secure {
			t.Error("secure must be set when X-Forwarded-Proto is https")
		}
	})
	t.Run("direct tls", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
		req.TLS = &tls.ConnectionState{}
		rec := httptest.NewRecorder()
		setRefreshCookie(rec, req, cookieCfg(""), "tok")
		if !refreshCookieFrom(t, rec).Secure {
			t.Error("secure must be set on TLS connections")
		}
	})
}

// TestClearRefreshCookie verifies the cookie is expired with matching
// attributes — a mismatched Path would leave the original cookie alive.
func TestClearRefreshCookie(t *testing.T) {
	rec := httptest.NewRecorder()
	clearRefreshCookie(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil), cookieCfg(""))
	c := refreshCookieFrom(t, rec)
	if c.Value != "" {
		t.Errorf("value: want empty, got %q", c.Value)
	}
	if c.MaxAge >= 0 {
		t.Errorf("max-age: want negative (delete), got %d", c.MaxAge)
	}
	if c.Path != refreshCookiePath {
		t.Errorf("path: want %s, got %s", refreshCookiePath, c.Path)
	}
}

// TestRefreshRequestToken pins the precedence rules the migration depends on:
// a body token always wins (legacy clients hand in their stored token once),
// the cookie kicks in only when the body carries nothing, and a bare cookie
// implies cookie mode without any flag.
func TestRefreshRequestToken(t *testing.T) {
	withCookie := func(value string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
		if value != "" {
			r.AddCookie(&http.Cookie{Name: refreshCookieName, Value: value})
		}
		return r
	}
	cases := []struct {
		name       string
		cookie     string
		bodyToken  string
		useCookie  bool
		wantToken  string
		wantCookie bool
	}{
		{"body only, no flag", "", "body-tok", false, "body-tok", false},
		{"body only, opt-in (migration)", "", "body-tok", true, "body-tok", true},
		{"body beats cookie", "cookie-tok", "body-tok", false, "body-tok", false},
		{"cookie only implies cookie mode", "cookie-tok", "", false, "cookie-tok", true},
		{"nothing", "", "", false, "", false},
		{"flag alone changes nothing without a token", "", "", true, "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			token, cookieMode := refreshRequestToken(withCookie(tc.cookie), tc.bodyToken, tc.useCookie)
			if token != tc.wantToken || cookieMode != tc.wantCookie {
				t.Errorf("got (%q, %v), want (%q, %v)", token, cookieMode, tc.wantToken, tc.wantCookie)
			}
		})
	}
}

// TestStripRefreshToken verifies cookie-mode responses cannot leak the token
// through the JSON body (the whole point of cookie mode) and that the caller's
// original pair — whose token goes into Set-Cookie — is left untouched.
func TestStripRefreshToken(t *testing.T) {
	if stripRefreshToken(nil) != nil {
		t.Fatal("nil in, nil out")
	}
	orig := &domain.TokenPair{AccessToken: "at", RefreshToken: "rt", ExpiresIn: 900}
	got := stripRefreshToken(orig)
	if got.RefreshToken != "" || got.AccessToken != "at" || got.ExpiresIn != 900 {
		t.Errorf("stripped pair wrong: %+v", got)
	}
	if orig.RefreshToken != "rt" {
		t.Error("original pair must not be mutated")
	}
	// The omitempty contract: cookie-mode JSON must not even carry the key.
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "refresh_token") {
		t.Errorf("cookie-mode JSON must omit refresh_token entirely, got %s", b)
	}
}
