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

func TestVerifySPF_LookupError(t *testing.T) {
	withLookupTXT(t, func(string) ([]string, error) {
		return nil, errors.New("dns timeout")
	})

	if _, err := VerifySPF("example.com", "mail.burnerbyte.com"); err == nil {
		t.Fatal("expected an error to propagate from the TXT lookup")
	}
}
