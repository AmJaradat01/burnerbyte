package service

import "testing"

// isDomainAllowed matches an (already lowercased) email domain against a
// comma-separated allowlist, trimming and lowercasing each entry.
func TestIsDomainAllowed(t *testing.T) {
	const list = "example.com, corp.example.com ,Other.COM"
	cases := map[string]bool{
		"example.com":      true,
		"corp.example.com": true,
		"other.com":        true, // "Other.COM" is trimmed + lowercased before compare
		"example.org":      false,
		"ample.com":        false, // not a substring/suffix match
		"":                 false,
	}
	for domain, want := range cases {
		if got := isDomainAllowed(domain, list); got != want {
			t.Errorf("isDomainAllowed(%q) = %v, want %v", domain, got, want)
		}
	}
	if isDomainAllowed("example.com", "") {
		t.Error("an empty allowlist should not match a non-empty domain")
	}
}

// isAuthMethodAllowed enforces an invite's allowed_auth list; empty means "any".
func TestIsAuthMethodAllowed(t *testing.T) {
	if !isAuthMethodAllowed(nil, "password") {
		t.Error("nil allowlist should allow any method")
	}
	if !isAuthMethodAllowed([]string{}, "sso:google") {
		t.Error("empty allowlist should allow any method")
	}
	if !isAuthMethodAllowed([]string{"any"}, "password") {
		t.Error(`"any" should allow any method`)
	}
	if !isAuthMethodAllowed([]string{"password", "sso:google"}, "sso:google") {
		t.Error("an explicitly listed method should be allowed")
	}
	if isAuthMethodAllowed([]string{"password"}, "sso:github") {
		t.Error("a method not in the list should be rejected")
	}
}

// ValidateIPs accepts plain IPs and CIDR ranges (v4 and v6), rejects anything else.
func TestValidateIPs(t *testing.T) {
	valid := [][]string{
		{},
		{"10.0.0.1"},
		{"192.168.0.0/24"},
		{"::1", "2001:db8::/32"},
		{"203.0.113.7", "198.51.100.0/24"},
	}
	for _, ips := range valid {
		if err := ValidateIPs(ips); err != nil {
			t.Errorf("ValidateIPs(%v) unexpected error: %v", ips, err)
		}
	}

	invalid := [][]string{
		{"not-an-ip"},
		{"10.0.0.1", "garbage"},
		{"999.999.999.999"},
		{"10.0.0.0/99"}, // prefix out of range
	}
	for _, ips := range invalid {
		if err := ValidateIPs(ips); err == nil {
			t.Errorf("ValidateIPs(%v) expected an error, got nil", ips)
		}
	}
}
