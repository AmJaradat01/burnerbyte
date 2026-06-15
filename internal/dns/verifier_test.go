package dns

import (
	"errors"
	"testing"
)

// withLookupTXT swaps the package lookupTXT resolver for the duration of a test.
func withLookupTXT(t *testing.T, fn func(string) ([]string, error)) {
	t.Helper()
	orig := lookupTXT
	lookupTXT = fn
	t.Cleanup(func() { lookupTXT = orig })
}

// Feature: enhanced-domains, task 3.2 — unit tests for VerifySPF.

func TestVerifySPF_ValidRecordContainingHost(t *testing.T) {
	withLookupTXT(t, func(string) ([]string, error) {
		return []string{
			"some-other-txt=value",
			"v=spf1 include:mail.burnerbyte.com ~all",
		}, nil
	})

	ok, err := VerifySPF("example.com", "mail.burnerbyte.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected SPF to verify when an spf1 record includes the expected host")
	}
}

func TestVerifySPF_RecordWithoutExpectedHost(t *testing.T) {
	withLookupTXT(t, func(string) ([]string, error) {
		return []string{"v=spf1 include:_spf.google.com ~all"}, nil
	})

	ok, err := VerifySPF("example.com", "mail.burnerbyte.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected SPF not to verify when the spf1 record omits the expected host")
	}
}

func TestVerifySPF_NoSPFRecord(t *testing.T) {
	withLookupTXT(t, func(string) ([]string, error) {
		// TXT records exist, but none is an SPF record.
		return []string{"google-site-verification=abc", "mail.burnerbyte.com"}, nil
	})

	ok, err := VerifySPF("example.com", "mail.burnerbyte.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected SPF not to verify when no record begins with v=spf1")
	}
}

// ResolveStatus must adopt a successful lookup result but preserve the previous
// value when the lookup errored, so a transient DNS failure never downgrades a
// verified domain (the recheck worker and manual/bulk verify all rely on this).
func TestResolveStatus(t *testing.T) {
	boom := errors.New("dns: server misbehaving")
	cases := []struct {
		name         string
		prev, result bool
		err          error
		want         bool
	}{
		{"success adopts true", false, true, nil, true},
		{"success adopts false", true, false, nil, false},
		{"error preserves a verified record", true, false, boom, true},
		{"error preserves an unverified record", false, false, boom, false},
		{"error preserves even a would-be-true result", false, true, boom, false},
	}
	for _, c := range cases {
		if got := ResolveStatus(c.prev, c.result, c.err); got != c.want {
			t.Errorf("%s: ResolveStatus(prev=%v, result=%v, err=%v) = %v, want %v",
				c.name, c.prev, c.result, c.err, got, c.want)
		}
	}
}

func TestVerifySPF_LookupError(t *testing.T) {
	withLookupTXT(t, func(string) ([]string, error) {
		return nil, errors.New("dns timeout")
	})

	if _, err := VerifySPF("example.com", "mail.burnerbyte.com"); err == nil {
		t.Fatal("expected an error to propagate from the TXT lookup")
	}
}
