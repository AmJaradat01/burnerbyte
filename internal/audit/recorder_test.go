package audit

import "testing"

func TestGetSeverity(t *testing.T) {
	cases := map[string]string{
		"admin.platform_settings_updated": "critical",
		"org.deleted":                     "critical",
		"user.locked":                     "critical",
		"member.removed":                  "warning",
		"inbox.deleted":                   "warning",
		"user.forgot_password":            "info",
		// Not in the map -> default "info". inbox.created and inbox.expired are
		// intentionally unclassified-as-info, unlike inbox.deleted (warning).
		"inbox.created":          "info",
		"inbox.expired":          "info",
		"totally.unknown.action": "info",
	}
	for action, want := range cases {
		if got := GetSeverity(action); got != want {
			t.Errorf("GetSeverity(%q) = %q, want %q", action, got, want)
		}
	}
}

func TestGetCategory(t *testing.T) {
	cases := map[string]string{
		"user.login":      "auth",
		"org.created":     "org",
		"member.invited":  "member",
		"team.created":    "team",
		"domain.created":  "domain",
		"inbox.created":   "inbox",
		"inbox.expired":   "inbox", // classified alongside the other inbox events
		"email.received":  "email",
		"webhook.created": "webhook",
		"apikey.created":  "apikey",
		// Not in the map -> default empty string.
		"totally.unknown.action": "",
	}
	for action, want := range cases {
		if got := GetCategory(action); got != want {
			t.Errorf("GetCategory(%q) = %q, want %q", action, got, want)
		}
	}
}

func TestStripPort(t *testing.T) {
	cases := map[string]string{
		"1.2.3.4:5678":    "1.2.3.4",
		"203.0.113.7:443": "203.0.113.7",
		"[::1]:8080":      "::1",
		// No port -> returned unchanged.
		"1.2.3.4": "1.2.3.4",
		"":        "",
	}
	for in, want := range cases {
		if got := stripPort(in); got != want {
			t.Errorf("stripPort(%q) = %q, want %q", in, got, want)
		}
	}
}
