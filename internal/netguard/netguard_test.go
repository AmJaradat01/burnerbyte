package netguard

import (
	"net"
	"testing"
)

// Moved here from internal/webhook when the blocklist was factored out, and
// extended with the ranges the webhook-only copy had missed.
func TestIsBlocked(t *testing.T) {
	blocked := []string{
		"10.0.0.1", "10.255.255.255",
		"172.16.0.1", "172.31.255.255",
		"192.168.0.1", "192.168.255.255",
		"127.0.0.1", "169.254.1.1",
		"169.254.169.254", // cloud metadata
		"::1", "fc00::1", "fe80::1",
		"0.0.0.0", "::", // unspecified — connect() reaches localhost on Linux
		"100.64.0.1", "100.127.255.255", // RFC6598 carrier-grade NAT
		"192.0.0.1",                    // IETF protocol assignments
		"198.18.0.1", "198.19.255.255", // RFC2544 benchmarking
		"::ffff:10.0.0.1",        // IPv4-mapped IPv6 must be judged as IPv4
		"::ffff:169.254.169.254", // the metadata address, mapped
	}
	for _, s := range blocked {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("bad test IP %q", s)
		}
		if !IsBlocked(ip) {
			t.Errorf("expected %s to be blocked", s)
		}
	}

	allowed := []string{
		"8.8.8.8", "1.1.1.1",
		"172.15.255.255", // just below 172.16.0.0/12
		"172.32.0.1",     // just above 172.16.0.0/12
		"100.63.255.255", // just below 100.64.0.0/10
		"100.128.0.1",    // just above 100.64.0.0/10
		"198.17.255.255", // just below 198.18.0.0/15
		"198.20.0.1",     // just above 198.18.0.0/15
		"2606:4700:4700::1111",
	}
	for _, s := range allowed {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("bad test IP %q", s)
		}
		if IsBlocked(ip) {
			t.Errorf("expected %s to be allowed", s)
		}
	}

	if !IsBlocked(nil) {
		t.Error("a nil address must not be treated as reachable")
	}
}

func TestResolveSafeRejectsInternalLiterals(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "169.254.169.254", "10.1.2.3"} {
		if _, err := ResolveSafe(t.Context(), s); err == nil {
			t.Errorf("ResolveSafe(%q) allowed an internal address", s)
		}
	}
}

func TestResolveSafeAcceptsPublicLiteral(t *testing.T) {
	ips, err := ResolveSafe(t.Context(), "8.8.8.8")
	if err != nil {
		t.Fatalf("public literal rejected: %v", err)
	}
	if len(ips) != 1 || ips[0].String() != "8.8.8.8" {
		t.Errorf("got %v, want [8.8.8.8]", ips)
	}
}

// A literal is returned without a DNS lookup, so the address that gets dialed
// is always the one that was checked.
func TestResolveSafeDoesNotReResolveLiterals(t *testing.T) {
	ips, err := ResolveSafe(t.Context(), "203.0.113.5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ips) != 1 || !ips[0].Equal(net.ParseIP("203.0.113.5")) {
		t.Errorf("got %v, want the literal back unchanged", ips)
	}
}
