package smtp

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/jhillyerd/enmime"
)

// Listener accepts inbound SMTP connections, parses emails using enmime,
// and enqueues them into the Server's processing pipeline.
type Listener struct {
	server   *Server
	router   *Router
	ln       net.Listener
	hostname string
	maxSize  int64
	wg       sync.WaitGroup
}

func NewListener(server *Server, router *Router) *Listener {
	maxSize := server.cfg.MaxSize
	if maxSize <= 0 {
		maxSize = 25 * 1024 * 1024 // 25 MB default
	}
	return &Listener{
		server:   server,
		router:   router,
		hostname: server.cfg.Hostname,
		maxSize:  maxSize,
	}
}

// ListenAndServe starts the SMTP listener. It blocks until ctx is cancelled.
func (l *Listener) ListenAndServe(ctx context.Context, addr string) error {
	var err error
	l.ln, err = net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp listen on %s: %w", addr, err)
	}
	slog.Info("smtp listener started", "addr", addr, "hostname", l.hostname)

	// Close the listener when context is cancelled to unblock Accept().
	go func() {
		<-ctx.Done()
		l.ln.Close() //nolint:errcheck
	}()

	for {
		conn, err := l.ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				// Wait for in-flight connections to finish.
				l.wg.Wait()
				slog.Info("smtp listener stopped")
				return nil
			default:
				slog.Error("smtp accept error", "error", err)
				continue
			}
		}
		l.wg.Add(1)
		go func() {
			defer l.wg.Done()
			l.handleConn(ctx, conn)
		}()
	}
}

// smtpSession holds the state for a single SMTP conversation.
type smtpSession struct {
	conn     net.Conn
	reader   *bufio.Reader
	hostname string
	maxSize  int64
	from     string
	rcptTo   []string
}

func (l *Listener) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	remoteAddr := conn.RemoteAddr().String()
	slog.Debug("smtp connection opened", "remote", remoteAddr)

	sess := &smtpSession{
		conn:     conn,
		reader:   bufio.NewReader(conn),
		hostname: l.hostname,
		maxSize:  l.maxSize,
	}

	sess.writef("220 %s ESMTP BurnerByte", l.hostname)

	for {
		// Per-command timeout.
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute)) //nolint:errcheck

		line, err := sess.reader.ReadString('\n')
		if err != nil {
			if err != io.EOF {
				slog.Debug("smtp read error", "error", err, "remote", remoteAddr)
			}
			return
		}
		line = strings.TrimRight(line, "\r\n")

		if line == "" {
			continue
		}

		// Parse command and argument.
		cmd, arg := parseCommand(line)

		switch cmd {
		case "HELO":
			sess.writef("250 %s Hello %s", l.hostname, arg)

		case "EHLO":
			sess.writef("250-%s Hello %s", l.hostname, arg)
			sess.writef("250-SIZE %d", l.maxSize)
			sess.writef("250-8BITMIME")
			sess.writef("250-PIPELINING")
			sess.writef("250 ENHANCEDSTATUSCODES")

		case "MAIL":
			from := extractMailParam(arg, "FROM")
			if from == "" {
				sess.writef("501 5.5.4 Syntax: MAIL FROM:<address>")
				continue
			}
			sess.from = from
			sess.rcptTo = nil
			sess.writef("250 2.1.0 OK")

		case "RCPT":
			if sess.from == "" {
				sess.writef("503 5.5.1 MAIL FROM required first")
				continue
			}
			to := extractMailParam(arg, "TO")
			if to == "" {
				sess.writef("501 5.5.4 Syntax: RCPT TO:<address>")
				continue
			}
			// Limit recipients per message to prevent abuse
			if len(sess.rcptTo) >= 100 {
				sess.writef("452 4.5.3 Too many recipients")
				continue
			}
			// Validate recipient against our router.
			if _, err := l.router.CanAccept(ctx, to); err != nil {
				slog.Debug("smtp rcpt rejected", "to", to, "reason", err)
				sess.writef("550 5.1.1 <%s> Recipient rejected", to)
				continue
			}
			sess.rcptTo = append(sess.rcptTo, to)
			sess.writef("250 2.1.5 OK")

		case "DATA":
			if sess.from == "" {
				sess.writef("503 5.5.1 MAIL FROM required first")
				continue
			}
			if len(sess.rcptTo) == 0 {
				sess.writef("503 5.5.1 RCPT TO required first")
				continue
			}
			sess.writef("354 Start mail input; end with <CRLF>.<CRLF>")

			data, err := sess.readData()
			if err != nil {
				slog.Error("smtp data read error", "error", err, "remote", remoteAddr)
				sess.writef("451 4.3.0 Error reading message data")
				continue
			}
			if int64(len(data)) > l.maxSize {
				sess.writef("552 5.3.4 Message size exceeds limit")
				continue
			}

			l.processData(ctx, sess.from, sess.rcptTo, data)
			sess.writef("250 2.0.0 OK: message queued")

			// Reset for next message in same session.
			sess.from = ""
			sess.rcptTo = nil

		case "RSET":
			sess.from = ""
			sess.rcptTo = nil
			sess.writef("250 2.0.0 OK")

		case "NOOP":
			sess.writef("250 2.0.0 OK")

		case "VRFY":
			sess.writef("252 2.5.0 Cannot VRFY user")

		case "QUIT":
			sess.writef("221 2.0.0 %s closing connection", l.hostname)
			return

		default:
			sess.writef("502 5.5.2 Command not recognized")
		}
	}
}

// readData reads the message body after the DATA command, terminated by
// a line containing only ".". Handles dot-stuffing per RFC 5321 §4.5.2.
func (s *smtpSession) readData() ([]byte, error) {
	var buf bytes.Buffer
	for {
		// Extend deadline for each line during DATA transfer.
		s.conn.SetReadDeadline(time.Now().Add(3 * time.Minute)) //nolint:errcheck

		line, err := s.reader.ReadString('\n')
		if err != nil {
			return nil, err
		}

		// Check for termination dot.
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "." {
			return buf.Bytes(), nil
		}

		// Dot-stuffing: a leading dot is removed if the line isn't the terminator.
		if strings.HasPrefix(trimmed, ".") {
			line = line[1:]
		}

		if int64(buf.Len())+int64(len(line)) > s.maxSize {
			return nil, fmt.Errorf("message exceeds max size")
		}

		buf.WriteString(line)
	}
}

func (s *smtpSession) writef(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(s.conn, "%s\r\n", msg)
}

// processData parses the raw email using enmime and enqueues it for each recipient.
func (l *Listener) processData(ctx context.Context, from string, rcptTo []string, data []byte) {
	envelope, err := enmime.ReadEnvelope(bytes.NewReader(data))
	if err != nil {
		slog.Error("smtp: failed to parse email", "error", err, "from", from)
		// Fall back to raw data if MIME parsing fails.
		for _, to := range rcptTo {
			email := &InboundEmail{
				From:       from,
				To:         to,
				Subject:    "(parse error)",
				BodyText:   string(data),
				Headers:    map[string]string{},
				SizeBytes:  int64(len(data)),
				ReceivedAt: time.Now(),
			}
			l.server.Enqueue(email)
		}
		return
	}

	// Extract headers.
	headers := make(map[string]string)
	for _, key := range envelope.GetHeaderKeys() {
		headers[key] = envelope.GetHeader(key)
	}

	// Extract attachments.
	var attachments []InboundAttachment
	for _, att := range envelope.Attachments {
		attachments = append(attachments, InboundAttachment{
			Filename:    att.FileName,
			ContentType: att.ContentType,
			Data:        att.Content,
		})
	}
	// Inline attachments too (images embedded in HTML).
	for _, att := range envelope.Inlines {
		if att.FileName != "" {
			attachments = append(attachments, InboundAttachment{
				Filename:    att.FileName,
				ContentType: att.ContentType,
				Data:        att.Content,
			})
		}
	}

	messageID := envelope.GetHeader("Message-ID")
	subject := envelope.GetHeader("Subject")

	for _, to := range rcptTo {
		email := &InboundEmail{
			MessageID:   messageID,
			From:        from,
			To:          to,
			Subject:     subject,
			BodyText:    envelope.Text,
			BodyHTML:    envelope.HTML,
			Headers:     headers,
			SizeBytes:   int64(len(data)),
			Attachments: attachments,
			ReceivedAt:  time.Now(),
		}
		if !l.server.Enqueue(email) {
			slog.Warn("smtp queue full, dropping email", "to", to, "from", from, "subject", subject)
		}
	}

	slog.Info("smtp email parsed and enqueued",
		"from", from,
		"recipients", len(rcptTo),
		"subject", subject,
		"attachments", len(attachments),
		"size", len(data),
	)
}

// parseCommand splits an SMTP command line into the command verb and its argument.
func parseCommand(line string) (cmd, arg string) {
	parts := strings.SplitN(line, " ", 2)
	cmd = strings.ToUpper(parts[0])
	if len(parts) > 1 {
		arg = parts[1]
	}
	return
}

// extractMailParam extracts the email address from "FROM:<addr>" or "TO:<addr>"
// parameters, handling optional ESMTP parameters after the address.
func extractMailParam(arg, verb string) string {
	// Strip the verb prefix if present (e.g., "FROM:" from "MAIL FROM:<addr>").
	upper := strings.ToUpper(arg)
	prefix := verb + ":"
	if idx := strings.Index(upper, prefix); idx >= 0 {
		arg = arg[idx+len(prefix):]
	}
	arg = strings.TrimSpace(arg)

	// Extract address from angle brackets.
	if start := strings.Index(arg, "<"); start >= 0 {
		if end := strings.Index(arg[start:], ">"); end >= 0 {
			return strings.TrimSpace(arg[start+1 : start+end])
		}
	}

	// No angle brackets — take everything up to the first space (ESMTP params).
	if idx := strings.IndexByte(arg, ' '); idx >= 0 {
		return strings.TrimSpace(arg[:idx])
	}
	return strings.TrimSpace(arg)
}
