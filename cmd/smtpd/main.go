package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/amjaradat01/burnerbyte/internal/repository/redis"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
	"gitlab.com/amjaradat01/burnerbyte/internal/smtp"
	"gitlab.com/amjaradat01/burnerbyte/internal/storage"
	"gitlab.com/amjaradat01/burnerbyte/internal/webhook"
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
	defer rdb.Close()

	// Repositories
	inboxRepoPG := postgres.NewInboxRepo(pool)
	emailRepo := postgres.NewEmailRepo(pool)
	domainRepo := postgres.NewDomainRepo(pool)
	assignmentRepo := postgres.NewDomainAssignmentRepo(pool)
	webhookRepo := postgres.NewWebhookRepo(pool)
	attachmentRepo := postgres.NewAttachmentRepo(pool)
	orgRepo := postgres.NewOrgRepo(pool)
	inboxRepoRedis := redisrepo.NewInboxRepo(rdb)

	// MinIO
	s3Client, err := storage.NewS3(ctx, cfg.MinIO)
	if err != nil {
		slog.Error("failed to connect to minio", "error", err)
		os.Exit(1)
	}

	// Services
	attachmentSvc := service.NewAttachmentService(attachmentRepo, emailRepo, inboxRepoPG, s3Client, cfg.MinIO, cfg.Defaults.MaxAttachmentSizeMB)
	settingsResolver := service.NewSettingsResolver(assignmentRepo, domainRepo, orgRepo, cfg.Defaults)

	// SMTP components
	router := smtp.NewRouter(domainRepo, inboxRepoRedis, inboxRepoPG)
	dispatcher := webhook.NewDispatcher(webhookRepo)
	handler := smtp.NewHandler(inboxRepoPG, inboxRepoRedis, emailRepo, assignmentRepo, dispatcher, nil, nil, attachmentSvc, settingsResolver)
	server := smtp.NewServer(cfg.SMTP, handler)
	listener := smtp.NewListener(server, router)

	// Start the processing worker pool.
	go server.Start(ctx)

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
