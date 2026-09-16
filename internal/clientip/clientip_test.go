package clientip

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The bug these guard against: chi's middleware.RealIP rewrote r.RemoteAddr
// from True-Client-IP / X-Real-IP / X-Forwarded-For with no trusted-proxy
// check, so the /metrics loopback gate, every rate limiter, the API-key IP
// allowlist and the audit trail all keyed on a value the caller chose. A
// header must never be able to change the answer unless the peer is a
// configured proxy.

func request(remoteAddr string, headers map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remoteAddr
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestUntrustedPeerCannotSpoofItsAddress(t *testing.T) {
	// Default configuration: no trusted proxies at all.
	res := New(nil)
	for _, header := range []string{"True-Client-IP", "X-Real-IP", "X-Forwarded-For"} {
		t.Run(header, func(t *testing.T) {
			r := request("198.51.100.7:44321", map[string]string{header: "127.0.0.1"})
			if got := res.Resolve(r); got != "198.51.100.7" {
				t.Errorf("%s spoofed the client IP: got %q, want the real peer 198.51.100.7", header, got)
			}
		})
	}
}

func TestTrustedProxyForwardedHeaderIsHonoured(t *testing.T) {
	res := New([]string{"10.0.0.0/8"})
	r := request("10.1.2.3:9000", map[string]string{"X-Forwarded-For": "203.0.113.9"})
	if got := res.Resolve(r); got != "203.0.113.9" {
		t.Errorf("trusted proxy's X-Forwarded-For ignored: got %q", got)
	}
}

func TestTrustedProxyUsesRightmostForwardedEntry(t *testing.T) {
	// Only the last entry was appended by our own proxy; everything to its
	// left is client-supplied and must not be believed.
	res := New([]string{"10.0.0.0/8"})
	r := request("10.1.2.3:9000", map[string]string{"X-Forwarded-For": "127.0.0.1, 203.0.113.9"})
	if got := res.Resolve(r); got != "203.0.113.9" {
		t.Errorf("client-supplied leftmost entry was trusted: got %q", got)
	}
}

func TestBareTrustedProxyAddressIsTreatedAsSingleHost(t *testing.T) {
	res := New([]string{"10.1.2.3"})
	trusted := request("10.1.2.3:9000", map[string]string{"X-Real-IP": "203.0.113.9"})
	if got := res.Resolve(trusted); got != "203.0.113.9" {
		t.Errorf("bare trusted address not honoured: got %q", got)
	}
	other := request("10.1.2.4:9000", map[string]string{"X-Real-IP": "203.0.113.9"})
	if got := res.Resolve(other); got != "10.1.2.4" {
		t.Errorf("a neighbouring address was treated as trusted: got %q", got)
	}
}

func TestGarbageForwardedValueFallsBackToPeer(t *testing.T) {
	res := New([]string{"10.0.0.0/8"})
	r := request("10.1.2.3:9000", map[string]string{"X-Forwarded-For": "not-an-ip"})
	if got := res.Resolve(r); got != "10.1.2.3" {
		t.Errorf("unparseable header should fall back to the peer: got %q", got)
	}
}

func TestMiddlewarePublishesResolvedIPAndLeavesRemoteAddrAlone(t *testing.T) {
	res := New(nil)
	var seen string
	var remoteAddr string
	h := res.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = From(r)
		remoteAddr = r.RemoteAddr
	}))
	r := request("198.51.100.7:44321", map[string]string{"True-Client-IP": "127.0.0.1"})
	h.ServeHTTP(httptest.NewRecorder(), r)

	if seen != "198.51.100.7" {
		t.Errorf("context carried a spoofed IP: %q", seen)
	}
	// chi's RealIP overwrote this; ours must not, so a handler reading it
	// directly still sees the true peer.
	if remoteAddr != "198.51.100.7:44321" {
		t.Errorf("RemoteAddr was rewritten: %q", remoteAddr)
	}
}

func TestFromFallsBackToPeerWithoutMiddleware(t *testing.T) {
	r := request("198.51.100.7:44321", map[string]string{"X-Forwarded-For": "127.0.0.1"})
	if got := From(r); got != "198.51.100.7" {
		t.Errorf("fallback trusted a header: got %q", got)
	}
	if _, ok := FromContext(r.Context()); ok {
		t.Error("FromContext reported a value that was never set")
	}
}

// The scheme trust rule is deliberately looser than the IP one, because the
// two fail in opposite directions: a forged IP picks your rate-limit bucket,
// a forged scheme can only make the response more restrictive.
func TestIsHTTPS(t *testing.T) {
	cases := []struct {
		name    string
		proxies []string
		peer    string
		header  string
		want    bool
	}{
		{"no header, no tls", nil, "198.51.100.7:1", "", false},
		{"header honoured when no proxies are configured", nil, "198.51.100.7:1", "https", true},
		{"trusted proxy is believed", []string{"10.0.0.0/8"}, "10.1.2.3:1", "https", true},
		{"untrusted peer is ignored once a list exists", []string{"10.0.0.0/8"}, "198.51.100.7:1", "https", false},
		{"http from a trusted proxy stays http", []string{"10.0.0.0/8"}, "10.1.2.3:1", "http", false},
		{"leftmost entry of a chain wins", []string{"10.0.0.0/8"}, "10.1.2.3:1", "https, http", true},
		{"case insensitive", nil, "198.51.100.7:1", "HTTPS", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := request(tc.peer, nil)
			if tc.header != "" {
				r.Header.Set("X-Forwarded-Proto", tc.header)
			}
			if got := New(tc.proxies).IsHTTPS(r); got != tc.want {
				t.Errorf("IsHTTPS = %v, want %v", got, tc.want)
			}
		})
	}
}

// Without the middleware installed the fallback must still honour the header:
// under-reporting here would strip Secure from a cookie on a connection that
// really is TLS-terminated upstream.
func TestIsHTTPSFromFallbackHonoursHeader(t *testing.T) {
	r := request("198.51.100.7:1", map[string]string{"X-Forwarded-Proto": "https"})
	if !IsHTTPSFrom(r) {
		t.Error("fallback ignored X-Forwarded-Proto; refresh cookies would lose Secure")
	}
	plain := request("198.51.100.7:1", nil)
	if IsHTTPSFrom(plain) {
		t.Error("plain HTTP reported as TLS")
	}
}

func TestMiddlewarePublishesScheme(t *testing.T) {
	var got bool
	h := New(nil).Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = IsHTTPSFrom(r)
	}))
	h.ServeHTTP(httptest.NewRecorder(), request("198.51.100.7:1", map[string]string{"X-Forwarded-Proto": "https"}))
	if !got {
		t.Error("resolved scheme did not reach the handler")
	}
}
