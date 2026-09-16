package smtp

import (
	"bytes"
	"testing"

	"github.com/jhillyerd/enmime"
	"github.com/microcosm-cc/bluemonday"
)

// The MIME parser is the most exposed untrusted surface the product has: it
// runs on whatever arrives over SMTP from anyone on the internet, before any
// authentication. The audit assessed it through dependency reachability and
// the sanitisation chain but never fuzzed it, so this closes that gap.
//
// The contract is not "never errors" — processData already falls back to
// storing the raw body when parsing fails. It is "never panics and never
// hangs", because either would take down the daemon for every tenant.
func FuzzReadEnvelope(f *testing.F) {
	f.Add([]byte("From: a@b.test\r\nTo: c@d.test\r\nSubject: hi\r\n\r\nbody\r\n"))
	f.Add([]byte("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>hi</p>\r\n--x--\r\n"))
	// Shapes that have historically broken MIME parsers.
	f.Add([]byte("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\n"))                  // unterminated part
	f.Add([]byte("Content-Type: multipart/mixed; boundary=\r\n\r\n----\r\n"))                  // empty boundary
	f.Add([]byte("Content-Transfer-Encoding: base64\r\n\r\n!!!!not base64!!!!\r\n"))           // bad encoding
	f.Add([]byte("Subject: =?utf-8?B?////?=\r\n\r\nx"))                                        // bad encoded-word
	f.Add([]byte("Content-Type: text/html\r\n\r\n<a href=\"\x00\"><<<>>></a>"))                // null byte + broken HTML
	f.Add([]byte("Content-Type: message/rfc822\r\n\r\nContent-Type: message/rfc822\r\n\r\nx")) // nesting

	sanitizer := bluemonday.UGCPolicy()

	f.Fuzz(func(t *testing.T, data []byte) {
		// A parse error is a valid outcome; a panic is not.
		env, err := enmime.ReadEnvelope(bytes.NewReader(data))
		if err != nil || env == nil {
			return
		}
		// Exercise everything processData touches afterwards, including the
		// sanitiser that stands between a hostile body and stored XSS.
		_ = env.Text
		_ = env.GetHeader("Subject")
		_ = env.GetHeader("Message-ID")
		if env.HTML != "" {
			out := sanitizer.Sanitize(env.HTML)
			// The sanitiser's whole job is removing script; if one survives,
			// the stored-XSS barrier has a hole worth knowing about.
			if bytes.Contains(bytes.ToLower([]byte(out)), []byte("<script")) {
				t.Fatalf("bluemonday let a <script> through: %q", out)
			}
		}
		for _, a := range env.Attachments {
			_ = a.FileName
			_ = a.Content
		}
		for _, a := range env.Inlines {
			_ = a.FileName
		}
	})
}
