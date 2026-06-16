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
	"gitlab.com/burnerbyte/burnerbyte/internal/mailer"
)

// mustMailer builds a Mailer for tests (templates parse from the embedded FS).
func mustMailer(t *testing.T, cfg config.MailerConfig) *mailer.Mailer {
	t.Helper()
	m, err := mailer.New(cfg)
	if err != nil {
		t.Fatalf("mailer.New: %v", err)
	}
	return m
}

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
		h := &AdminHandler{mailer: mustMailer(t, config.MailerConfig{})}
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

		h := &AdminHandler{mailer: mustMailer(t, config.MailerConfig{Host: "mail.example.com", Port: 587})}
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

		h := &AdminHandler{mailer: mustMailer(t, config.MailerConfig{Host: host, Port: port})}
		rec := httptest.NewRecorder()
		h.TestSMTP(rec, httptest.NewRequest(http.MethodPost, "/admin/infra/test-smtp", nil))
		ok, msg := decodeSMTPResult(t, rec.Body)
		if !ok {
			t.Fatalf("expected success, got %q", msg)
		}
	})
}

// TestAdminMailerConfig covers the runtime mailer editor: GET masks the password
// (exposing only has_password), and PUT rejects invalid input before persisting.
func TestAdminMailerConfig(t *testing.T) {
	t.Run("get masks password", func(t *testing.T) {
		h := &AdminHandler{mailer: mustMailer(t, config.MailerConfig{
			Host: "mail.example.com", Port: 587, Username: "u", Password: "secret", From: "no-reply@example.com", TLS: true,
		})}
		rec := httptest.NewRecorder()
		h.GetMailerConfig(rec, httptest.NewRequest(http.MethodGet, "/admin/config/mailer", nil))
		var resp map[string]any
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if _, leaked := resp["password"]; leaked {
			t.Error("password must not be returned")
		}
		if resp["has_password"] != true {
			t.Errorf("has_password = %v, want true", resp["has_password"])
		}
		if resp["host"] != "mail.example.com" {
			t.Errorf("host = %v", resp["host"])
		}
	})

	t.Run("put validation", func(t *testing.T) {
		h := &AdminHandler{mailer: mustMailer(t, config.MailerConfig{})}
		cases := []string{
			`{"host":"","port":587,"from":"a@b.com"}`,            // missing host
			`{"host":"mail.x","port":0,"from":"a@b.com"}`,        // bad port
			`{"host":"mail.x","port":70000,"from":"a@b.com"}`,    // port too high
			`{"host":"mail.x","port":587,"from":"not-an-email"}`, // bad from
		}
		for _, body := range cases {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/admin/config/mailer", strings.NewReader(body))
			h.UpdateMailerConfig(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("body %s: status = %d, want 400", body, rec.Code)
			}
		}
	})
}

// TestAdminUpdateStorageConfigValidation checks the required-field guards, which
// run before any database or storage access (so no backend is needed here).
func TestAdminUpdateStorageConfigValidation(t *testing.T) {
	h := &AdminHandler{}
	cases := []string{
		`{"endpoint":"","access_key":"k"}`, // missing endpoint
		`{"endpoint":"e","access_key":""}`, // missing access key
	}
	for _, body := range cases {
		rec := httptest.NewRecorder()
		h.UpdateStorageConfig(rec, httptest.NewRequest(http.MethodPut, "/admin/config/storage", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
}
