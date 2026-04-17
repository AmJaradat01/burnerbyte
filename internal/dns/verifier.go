package dns

import (
	"fmt"
	"net"
	"strings"
)

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
	records, err := net.LookupTXT(domainName)
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

// GenerateVerificationRecord returns the TXT record value the user should add.
func GenerateVerificationRecord(domainID string) string {
	return fmt.Sprintf("burnerbyte-verify=%s", domainID)
}

// VerifySPF checks if the domain has a TXT record starting with "v=spf1"
// that includes the expected hostname.
func VerifySPF(domainName, expectedHost string) (bool, error) {
	records, err := net.LookupTXT(domainName)
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
