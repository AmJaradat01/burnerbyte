package dns

import (
	"fmt"
	"net"
	"strings"
)

// lookupTXT resolves a domain's TXT records. It is a package variable so tests
// can substitute a fake resolver; production code uses net.LookupTXT.
var lookupTXT = net.LookupTXT

// VerifyMX checks if the domain has an MX record pointing to the expected hostname.
func VerifyMX(domainName, expectedHost string) (bool, error) {
	records, err := net.LookupMX(domainName)
	if err != nil {
		return false, fmt.Errorf("mx lookup: %w", err)
	}
	for _, mx := range records {
		host := strings.TrimSuffix(mx.Host, ".")
		if strings.EqualFold(host, expectedHost) {
			return true, nil
		}
	}
	return false, nil
}

// VerifyTXT checks if the domain has a TXT record containing the expected value.
func VerifyTXT(domainName, expectedValue string) (bool, error) {
	records, err := lookupTXT(domainName)
	if err != nil {
		return false, fmt.Errorf("txt lookup: %w", err)
	}
	for _, txt := range records {
		if strings.Contains(txt, expectedValue) {
			return true, nil
		}
	}
	return false, nil
}

// ResolveStatus returns the freshly looked-up result, except when the lookup
// errored, in which case it preserves the previous value. A transient DNS or
// network failure must not flip a verified record to unverified.
func ResolveStatus(prev, result bool, err error) bool {
	if err != nil {
		return prev
	}
	return result
}

// GenerateVerificationRecord returns the TXT record value the user should add.
func GenerateVerificationRecord(domainID string) string {
	return fmt.Sprintf("burnerbyte-verify=%s", domainID)
}

// VerifySPF checks if the domain has a TXT record starting with "v=spf1"
// that includes the expected hostname.
func VerifySPF(domainName, expectedHost string) (bool, error) {
	records, err := lookupTXT(domainName)
	if err != nil {
		return false, fmt.Errorf("spf lookup: %w", err)
	}
	for _, txt := range records {
		if strings.HasPrefix(txt, "v=spf1") && strings.Contains(txt, expectedHost) {
			return true, nil
		}
	}
	return false, nil
}
