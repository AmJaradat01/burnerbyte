package auth

import "testing"

// TestClaimBool locks in the fail-closed parsing of OIDC boolean claims such as
// email_verified, which gates the SSO email-verification check. Only a real
// boolean true or the string "true" counts as true; missing, numeric, or any
// other value is false, so an unverified/omitted claim can't be mistaken for
// verified.
func TestClaimBool(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want bool
	}{
		{"bool true", true, true},
		{"bool false", false, false},
		{"string true", "true", true},
		{"string false", "false", false},
		{"string other", "yes", false},
		{"string empty", "", false},
		{"nil/missing", nil, false},
		{"number one", 1, false},
		{"number zero", 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := claimBool(c.in); got != c.want {
				t.Errorf("claimBool(%#v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}
