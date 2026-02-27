package mailer

import (
	"bytes"
	"crypto/tls"
	"embed"
	"fmt"
	"html/template"
	"log/slog"
	"net/smtp"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

//go:embed templates/*.html
var templateFS embed.FS

type Mailer struct {
	cfg       config.MailerConfig
	templates *template.Template
}

func New(cfg config.MailerConfig) (*Mailer, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("parse email templates: %w", err)
	}
	return &Mailer{cfg: cfg, templates: tmpl}, nil
}

func (m *Mailer) isConfigured() bool {
	return m.cfg.Host != ""
}

func (m *Mailer) Send(to, subject, templateName string, data any) error {
	var body bytes.Buffer
	if err := m.templates.ExecuteTemplate(&body, templateName, data); err != nil {
		return fmt.Errorf("execute template %s: %w", templateName, err)
	}

	if !m.isConfigured() {
		slog.Info("mailer not configured, logging email",
			"to", to, "subject", subject, "body_preview", truncate(body.String(), 200))
		return nil
	}

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s",
		m.cfg.From, to, subject, body.String())

	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)

	var auth smtp.Auth
	if m.cfg.Username != "" {
		auth = smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	}

	if m.cfg.TLS {
		return m.sendTLS(addr, auth, to, []byte(msg))
	}

	return smtp.SendMail(addr, auth, m.cfg.From, []string{to}, []byte(msg))
}

func (m *Mailer) sendTLS(addr string, auth smtp.Auth, to string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: m.cfg.Host})
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}

	client, err := smtp.NewClient(conn, m.cfg.Host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(m.cfg.From); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}

	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func (m *Mailer) Reconfigure(cfg config.MailerConfig) {
	m.cfg = cfg
}
