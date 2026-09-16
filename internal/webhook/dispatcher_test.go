package webhook

import (
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
