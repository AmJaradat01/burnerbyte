package randaddr

import (
	"strings"
	"testing"
)

func TestGenerateLengthAndCharset(t *testing.T) {
	cases := []struct {
		in      int
		wantLen int
	}{
		{6, 6}, {8, 8}, {12, 12},
		{0, 6}, {3, 6}, {5, 6}, // clamped up to the 6 minimum
		{13, 12}, {100, 12}, // clamped down to the 12 maximum
	}
	for _, tc := range cases {
		s, err := Generate(tc.in)
		if err != nil {
			t.Fatalf("Generate(%d) error: %v", tc.in, err)
		}
		if len(s) != tc.wantLen {
			t.Fatalf("Generate(%d) length = %d, want %d", tc.in, len(s), tc.wantLen)
		}
		for _, r := range s {
			if !strings.ContainsRune(charset, r) {
				t.Fatalf("Generate(%d) produced %q outside the charset", tc.in, r)
			}
		}
	}
}

func TestGenerateIsRandom(t *testing.T) {
	seen := make(map[string]bool)
	const draws = 100
	for i := 0; i < draws; i++ {
		s, err := Generate(10)
		if err != nil {
			t.Fatalf("Generate error: %v", err)
		}
		seen[s] = true
	}
	// 100 draws from a 36^10 space — anything below near-100 distinct values
	// signals a broken generator (e.g. a constant or unseeded source).
	if len(seen) < draws-1 {
		t.Fatalf("expected ~%d distinct values, got %d", draws, len(seen))
	}
}
