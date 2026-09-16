package smtp

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/amjaradat01/burnerbyte/internal/config"
)

// Server wraps the SMTP inbound processing pipeline.
type Server struct {
	cfg     config.SMTPConfig
	handler *Handler
	queue   chan *InboundEmail
	stopped atomic.Bool
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

func (s *Server) Start(ctx context.Context) error {
	workers := s.cfg.Workers
	if workers <= 0 {
		workers = 4
	}

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			s.worker(ctx, id)
		}(i)
	}

	slog.Info("smtp server started",
		"listen", s.cfg.Listen,
		"hostname", s.cfg.Hostname,
		"queue_size", s.cfg.QueueSize,
		"workers", workers,
	)

	<-ctx.Done()
	s.stopped.Store(true) // Prevent new enqueues before closing channel
	close(s.queue)
	wg.Wait() // Wait for workers to drain
	return nil
}

// Enqueue adds a parsed email to the processing queue.
// Returns false if the queue is full or the server is shutting down.
func (s *Server) Enqueue(email *InboundEmail) bool {
	if s.stopped.Load() {
		return false
	}
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
		s.processOne(ctx, id, email)
	}
}

func (s *Server) processOne(ctx context.Context, id int, email *InboundEmail) {
	processCtx := ctx
	if ctx.Err() != nil {
		var cancel context.CancelFunc
		processCtx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel() // Now correctly scoped to this function call
	}
	if err := s.handler.Process(processCtx, email); err != nil {
		slog.Error("smtp worker: failed to process email",
			"worker_id", id, "to", email.To, "error", err)
	}
}
