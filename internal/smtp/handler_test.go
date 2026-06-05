package smtp

import "testing"

// TestCalcSpamScore covers the deterministic header/SPF scoring. ConnectingIP
// is left empty in every case so the network SPF TXT lookup is skipped and the
// score depends only on the message headers.
func TestCalcSpamScore(t *testing.T) {
	clean := func() *InboundEmail {
		return &InboundEmail{
			MessageID: "<id@example.com>",
			From:      "sender@example.com",
			Subject:   "Hello",
			Headers: map[string]string{
				"Received-SPF": "pass",
				"Date":         "Mon, 01 Jan 2024 00:00:00 +0000",
				"From":         "sender@example.com",
			},
		}
	}

	tests := []struct {
		name string
		mut  func(e *InboundEmail)
		want float32
	}{
		{"clean", func(e *InboundEmail) {}, 0},
		{"missing message-id", func(e *InboundEmail) { e.MessageID = "" }, 1.0},
		{"blank subject", func(e *InboundEmail) { e.Subject = "  " }, 0.5},
		{"spf fail", func(e *InboundEmail) { e.Headers["Received-SPF"] = "fail" }, 2.0},
		{"spf header absent", func(e *InboundEmail) { delete(e.Headers, "Received-SPF") }, 0.5},
		{"missing date", func(e *InboundEmail) { delete(e.Headers, "Date") }, 0.5},
		{"missing from header", func(e *InboundEmail) { delete(e.Headers, "From") }, 1.0},
		{"everything missing", func(e *InboundEmail) {
			e.MessageID = ""
			e.Subject = ""
			e.Headers = map[string]string{}
		}, 3.5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := clean()
			tt.mut(e)
			if got := calcSpamScore(e); got != tt.want {
				t.Fatalf("calcSpamScore = %v, want %v", got, tt.want)
			}
		})
	}
}
