package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/burnerbyte/burnerbyte/internal/repository/redis"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
	"gitlab.com/burnerbyte/burnerbyte/internal/smtp"
	"gitlab.com/burnerbyte/burnerbyte/internal/storage"
	"gitlab.com/burnerbyte/burnerbyte/internal/webhook"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Logger
	logLevel := slog.LevelInfo
	if cfg.Logging.Level == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Database
	pool, err := database.NewPostgres(ctx, cfg.Database)
	if err != nil {
		slog.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Redis
	rdb, err := database.NewRedis(ctx, cfg.Redis)
	if err != nil {
		slog.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close() //nolint:errcheck

	// Repositories
	inboxRepoPG := postgres.NewInboxRepo(pool)
	emailRepo := postgres.NewEmailRepo(pool)
	domainRepo := postgres.NewDomainRepo(pool)
	assignmentRepo := postgres.NewDomainAssignmentRepo(pool)
	webhookRepo := postgres.NewWebhookRepo(pool)
	attachmentRepo := postgres.NewAttachmentRepo(pool)
	orgRepo := postgres.NewOrgRepo(pool)
	inboxRepoRedis := redisrepo.NewInboxRepo(rdb)

	// Load runtime configs from DB (overrides config.yaml/env for storage)
	sysConfigRepo := postgres.NewSystemConfigRepo(pool)
	cfg.LoadFromDB(ctx, sysConfigRepo)

	// MinIO (optional — attachments disabled when unavailable)
	s3Client, err := storage.NewS3(ctx, cfg.MinIO)
	if err != nil {
		slog.Warn("minio unavailable, attachments disabled", "error", err)
	}
	var attachmentSvc *service.AttachmentService
	if s3Client != nil {
		attachmentSvc = service.NewAttachmentService(attachmentRepo, emailRepo, inboxRepoPG, s3Client, cfg.MinIO, cfg.Defaults.MaxAttachmentSizeMB, cfg.Defaults.PresignedURLTTL)
	}
	settingsResolver := service.NewSettingsResolver(assignmentRepo, domainRepo, orgRepo, cfg.Defaults)

	// SMTP components
	router := smtp.NewRouter(domainRepo, inboxRepoRedis, inboxRepoPG)
	dispatcher := webhook.NewDispatcher(webhookRepo, cfg.Defaults.WebhookTimeout, cfg.Defaults.WebhookMaxRetries)
	handler := smtp.NewHandler(inboxRepoPG, inboxRepoRedis, emailRepo, assignmentRepo, dispatcher, nil, nil, attachmentSvc, settingsResolver)
	server := smtp.NewServer(cfg.SMTP, handler)
	listener := smtp.NewListener(server, router)

	// Start the processing worker pool.
	go server.Start(ctx) //nolint:errcheck

	// Start the TCP listener.
	go func() {
		if err := listener.ListenAndServe(ctx, cfg.SMTP.Listen); err != nil {
			slog.Error("smtp listener error", "error", err)
			os.Exit(1)
		}
	}()

	slog.Info("smtpd started",
		"listen", cfg.SMTP.Listen,
		"hostname", cfg.SMTP.Hostname,
		"max_size", cfg.SMTP.MaxSize,
		"workers", cfg.SMTP.Workers,
		"queue_size", cfg.SMTP.QueueSize,
	)

	// Wait for shutdown signal.
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)
	<-done

	slog.Info("smtpd shutting down")
	cancel() // Cancels ctx, which stops the listener and worker pool.
	slog.Info("smtpd stopped")
}
