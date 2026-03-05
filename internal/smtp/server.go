package smtp

import (
	"context"
	"log/slog"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// Server wraps the SMTP inbound processing pipeline.
type Server struct {
	cfg     config.SMTPConfig
	handler *Handler
	queue   chan *InboundEmail
}

func NewServer(cfg config.SMTPConfig, handler *Handler) *Server {
	queueSize := cfg.QueueSize
	if queueSize <= 0 {
		queueSize = 1000
	}
	return &Server{
		cfg:     cfg,
		handler: handler,
		queue:   make(chan *InboundEmail, queueSize),
	}
}

// Start begins the SMTP listener and worker pool.
// In production this would use go-guerrilla; here we set up the processing pipeline.
func (s *Server) Start(ctx context.Context) error {
	workers := s.cfg.Workers
	if workers <= 0 {
		workers = 4
	}

	// Start worker pool
	for i := 0; i < workers; i++ {
		go s.worker(ctx, i)
	}

	slog.Info("smtp server started",
		"listen", s.cfg.Listen,
		"hostname", s.cfg.Hostname,
		"queue_size", s.cfg.QueueSize,
		"workers", workers,
	)

	<-ctx.Done()
	close(s.queue)
	return nil
}

// Enqueue adds a parsed email to the processing queue.
// Returns false if the queue is full (caller should return SMTP 451).
func (s *Server) Enqueue(email *InboundEmail) bool {
	select {
	case s.queue <- email:
		return true
	default:
		slog.Warn("smtp queue full, rejecting email", "to", email.To)
		return false
	}
}

func (s *Server) worker(ctx context.Context, id int) {
	slog.Debug("smtp worker started", "worker_id", id)
	for email := range s.queue {
		if err := s.handler.Process(ctx, email); err != nil {
			slog.Error("smtp worker: failed to process email",
				"worker_id", id, "to", email.To, "error", err)
		}
	}
}
