package handler

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// isValidDomainFormat guards SSO domain-mapping input; it expects an already
// lowercased domain and enforces label, hyphen, and TLD-length rules.
func TestIsValidDomainFormat(t *testing.T) {
	valid := []string{
		"example.com",
		"mail.example.co.uk",
		"a-b.example.com",
		"x.io", // 2-character TLD (minimum)
		"sub.domain.example.org",
		"123.example.com", // digits are allowed in labels
	}
	for _, d := range valid {
		if !isValidDomainFormat(d) {
			t.Errorf("expected %q to be valid", d)
		}
	}

	invalid := []string{
		"",                // empty
		"ab",              // no dot, under the 3-char minimum
		"example",         // no dot
		".com",            // leading dot
		"example.",        // trailing dot
		"-example.com",    // leading hyphen
		"example.com-",    // trailing hyphen
		"example.c",       // 1-character TLD
		"exa mple.com",    // space
		"EXAMPLE.com",     // uppercase (validator expects pre-lowercased input)
		"example..com",    // empty label
		"under_score.com", // underscore is not an allowed character
	}
	for _, d := range invalid {
		if isValidDomainFormat(d) {
			t.Errorf("expected %q to be invalid", d)
		}
	}
}

// fakeSMTPServer starts a minimal in-process SMTP listener that speaks just
// enough of the protocol for smtp.Dial + Client.Quit (greeting, EHLO, QUIT).
func fakeSMTPServer(t *testing.T) (host string, port int, stop func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				br := bufio.NewReader(c)
				io.WriteString(c, "220 test ESMTP\r\n")
				for {
					line, err := br.ReadString('\n')
					if err != nil {
						return
					}
					cmd := strings.ToUpper(strings.TrimSpace(line))
					switch {
					case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
						io.WriteString(c, "250-test\r\n250 OK\r\n")
					case strings.HasPrefix(cmd, "QUIT"):
						io.WriteString(c, "221 bye\r\n")
						return
					default:
						io.WriteString(c, "250 OK\r\n")
					}
				}
			}(conn)
		}
	}()
	addr := ln.Addr().(*net.TCPAddr)
	return "127.0.0.1", addr.Port, func() { ln.Close() }
}

func decodeSMTPResult(t *testing.T, body io.Reader) (bool, string) {
	t.Helper()
	var resp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp.Success, resp.Message
}

// TestAdminTestSMTP covers the system-admin "test outbound SMTP" endpoint: the
// not-configured guard, a dial failure, and a successful connection against an
// in-process server. It exercises the same smtpDialTest path the setup wizard
// uses, but without the private-IP guard (this caller is authenticated).
func TestAdminTestSMTP(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		h := &AdminHandler{cfg: &config.Config{}}
		rec := httptest.NewRecorder()
		h.TestSMTP(rec, httptest.NewRequest(http.MethodPost, "/admin/infra/test-smtp", nil))
		ok, msg := decodeSMTPResult(t, rec.Body)
		if ok {
			t.Fatal("expected success=false when no SMTP is configured")
		}
		if !strings.Contains(msg, "no outbound SMTP") {
			t.Errorf("message = %q, want it to mention no SMTP configured", msg)
		}
	})

	t.Run("dial error", func(t *testing.T) {
		orig := smtpDial
		smtpDial = func(string) (*smtp.Client, error) { return nil, fmt.Errorf("connection refused") }
		defer func() { smtpDial = orig }()

		h := &AdminHandler{cfg: &config.Config{Mailer: config.MailerConfig{Host: "mail.example.com", Port: 587}}}
		rec := httptest.NewRecorder()
		h.TestSMTP(rec, httptest.NewRequest(http.MethodPost, "/admin/infra/test-smtp", nil))
		ok, msg := decodeSMTPResult(t, rec.Body)
		if ok {
			t.Fatal("expected success=false on dial error")
		}
		if !strings.Contains(msg, "connection refused") {
			t.Errorf("message = %q, want the dial error", msg)
		}
	})

	t.Run("success", func(t *testing.T) {
		host, port, stop := fakeSMTPServer(t)
		defer stop()

		h := &AdminHandler{cfg: &config.Config{Mailer: config.MailerConfig{Host: host, Port: port}}}
		rec := httptest.NewRecorder()
		h.TestSMTP(rec, httptest.NewRequest(http.MethodPost, "/admin/infra/test-smtp", nil))
		ok, msg := decodeSMTPResult(t, rec.Body)
		if !ok {
			t.Fatalf("expected success, got %q", msg)
		}
	})
}
