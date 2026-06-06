package webhook

import (
	"net"
	"strings"
	"testing"
)

func TestSign(t *testing.T) {
	// Published HMAC-SHA256 test vector (key "key", the pangram message).
	got := sign([]byte("The quick brown fox jumps over the lazy dog"), "key")
	const want = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
	if got != want {
		t.Fatalf("sign mismatch:\n got %s\nwant %s", got, want)
	}

	// 64 lowercase hex characters.
	if len(got) != 64 {
		t.Fatalf("expected 64 hex chars, got %d", len(got))
	}
	if strings.TrimLeft(got, "0123456789abcdef") != "" {
		t.Fatalf("signature is not lowercase hex: %s", got)
	}

	// Deterministic for identical input.
	if sign([]byte("payload"), "s") != sign([]byte("payload"), "s") {
		t.Fatal("sign must be deterministic for the same input")
	}
	// Sensitive to both the secret and the payload.
	if sign([]byte("payload"), "secret-a") == sign([]byte("payload"), "secret-b") {
		t.Fatal("different secrets must produce different signatures")
	}
	if sign([]byte("payload-a"), "s") == sign([]byte("payload-b"), "s") {
		t.Fatal("different payloads must produce different signatures")
	}
}

func TestIsPrivateIP(t *testing.T) {
	// These must be blocked — webhook delivery to them would be SSRF.
	private := []string{
		"10.0.0.1", "10.255.255.255",
		"172.16.0.1", "172.31.255.255",
		"192.168.0.1", "192.168.255.255",
		"127.0.0.1", "169.254.1.1",
		"169.254.169.254", // cloud metadata
		"::1", "fc00::1", "fe80::1",
		"0.0.0.0", "::", // unspecified — connect() reaches localhost on Linux
	}
	for _, s := range private {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("bad test IP %q", s)
		}
		if !isPrivateIP(ip) {
			t.Errorf("expected %s to be treated as private (blocked)", s)
		}
	}

	// These are public and must be allowed, including the CIDR boundaries.
	public := []string{
		"8.8.8.8", "1.1.1.1",
		"172.15.255.255", // just below 172.16.0.0/12
		"172.32.0.1",     // just above 172.16.0.0/12
		"2606:4700:4700::1111",
	}
	for _, s := range public {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("bad test IP %q", s)
		}
		if isPrivateIP(ip) {
			t.Errorf("expected %s to be treated as public (allowed)", s)
		}
	}
}
