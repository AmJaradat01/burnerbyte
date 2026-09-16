package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func originProbe(t *testing.T, method, origin, referer string) int {
	t.Helper()
	var reached bool
	h := SameOrigin([]string{"https://app.example.com"})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		reached = true
	}))
	r := httptest.NewRequest(method, "/api/v1/auth/refresh", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if referer != "" {
		r.Header.Set("Referer", referer)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code == http.StatusOK && !reached {
		t.Fatal("200 without reaching the handler")
	}
	return rec.Code
}

// Under the default SameSite=Lax a browser withholds the refresh cookie on a
// cross-site POST anyway; this guard is what covers same_site = "none", where
// it does not.
func TestSameOriginRejectsForeignOrigin(t *testing.T) {
	if got := originProbe(t, http.MethodPost, "https://evil.test", ""); got != http.StatusForbidden {
		t.Errorf("foreign origin got %d, want 403", got)
	}
}

func TestSameOriginAllowsConfiguredOrigin(t *testing.T) {
	if got := originProbe(t, http.MethodPost, "https://app.example.com", ""); got != http.StatusOK {
		t.Errorf("allowed origin got %d, want 200", got)
	}
	// Trailing slashes and case differ between browsers; neither should matter.
	if got := originProbe(t, http.MethodPost, "https://APP.example.com/", ""); got != http.StatusOK {
		t.Errorf("case/slash variant got %d, want 200", got)
	}
}

// Non-browser clients send no Origin and authenticate with a bearer token no
// browser would attach on their behalf, so they must keep working.
func TestSameOriginAllowsRequestsWithoutOrigin(t *testing.T) {
	if got := originProbe(t, http.MethodPost, "", ""); got != http.StatusOK {
		t.Errorf("no-origin client got %d, want 200", got)
	}
}

func TestSameOriginFallsBackToReferer(t *testing.T) {
	if got := originProbe(t, http.MethodPost, "", "https://evil.test/page"); got != http.StatusForbidden {
		t.Errorf("foreign referer got %d, want 403", got)
	}
	if got := originProbe(t, http.MethodPost, "", "https://app.example.com/page"); got != http.StatusOK {
		t.Errorf("allowed referer got %d, want 200", got)
	}
}

// Safe methods are not forgeable the way a form post is, and blocking them
// would break ordinary cross-origin reads that CORS already governs.
func TestSameOriginIgnoresSafeMethods(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		if got := originProbe(t, m, "https://evil.test", ""); got != http.StatusOK {
			t.Errorf("%s got %d, want 200", m, got)
		}
	}
}

func TestSameOriginWildcardDisablesTheCheck(t *testing.T) {
	var reached bool
	h := SameOrigin([]string{"*"})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set("Origin", "https://evil.test")
	h.ServeHTTP(httptest.NewRecorder(), r)
	if !reached {
		t.Error("a wildcard CORS config should not be second-guessed here")
	}
}
