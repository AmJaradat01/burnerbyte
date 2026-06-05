package handler

import "testing"

// isValidDomainFormat guards SSO domain-mapping input; it expects an already
// lowercased domain and enforces label, hyphen, and TLD-length rules.
func TestIsValidDomainFormat(t *testing.T) {
	valid := []string{
		"example.com",
		"mail.example.co.uk",
		"a-b.example.com",
		"x.io", // 2-character TLD (minimum)
		"sub.domain.example.org",
		"123.example.com", // digits are allowed in labels
	}
	for _, d := range valid {
		if !isValidDomainFormat(d) {
			t.Errorf("expected %q to be valid", d)
		}
	}

	invalid := []string{
		"",                // empty
		"ab",              // no dot, under the 3-char minimum
		"example",         // no dot
		".com",            // leading dot
		"example.",        // trailing dot
		"-example.com",    // leading hyphen
		"example.com-",    // trailing hyphen
		"example.c",       // 1-character TLD
		"exa mple.com",    // space
		"EXAMPLE.com",     // uppercase (validator expects pre-lowercased input)
		"example..com",    // empty label
		"under_score.com", // underscore is not an allowed character
	}
	for _, d := range invalid {
		if isValidDomainFormat(d) {
			t.Errorf("expected %q to be invalid", d)
		}
	}
}
