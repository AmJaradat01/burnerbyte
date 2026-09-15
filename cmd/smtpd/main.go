package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/amjaradat01/burnerbyte/internal/audit"
	"github.com/amjaradat01/burnerbyte/internal/cfgsync"
	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/database"
	"github.com/amjaradat01/burnerbyte/internal/realtime"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "github.com/amjaradat01/burnerbyte/internal/repository/redis"
	"github.com/amjaradat01/burnerbyte/internal/service"
	"github.com/amjaradat01/burnerbyte/internal/smtp"
	"github.com/amjaradat01/burnerbyte/internal/storage"
	"github.com/amjaradat01/burnerbyte/internal/webhook"
)

// Version is stamped at build time via -ldflags "-X main.Version=...".
var Version = "dev"

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

	// Object storage with a hot-swappable backend (Manager). The admin storage
	// editor (in the api process) broadcasts a reload over Redis; this process
	// subscribes and rebuilds its client live, so incoming-mail attachments keep
	// going to the same place the api serves them from. Optional: attachments are
	// disabled when no backend is available.
	var storageBackend storage.Backend
	s3Client, err := storage.NewS3(ctx, cfg.MinIO)
	if err != nil {
		slog.Warn("minio unavailable, using local filesystem for attachments", "error", err)
		localFS, fsErr := storage.NewLocalFS("./data/attachments", cfg.Server.BaseURL+"/api/v1/files")
		if fsErr == nil {
			storageBackend = localFS
			slog.Info("attachments enabled via local filesystem")
		}
	} else {
		storageBackend = s3Client
	}
	var attachmentSvc *service.AttachmentService
	if storageBackend != nil {
		storageMgr := storage.NewManager(storageBackend)
		attachmentSvc = service.NewAttachmentService(attachmentRepo, emailRepo, inboxRepoPG, storageMgr, cfg.MinIO, cfg.Defaults.MaxAttachmentSizeMB, cfg.Defaults.PresignedURLTTL)
		cfgsync.Subscribe(ctx, rdb, func(key string) {
			if key != "storage" {
				return
			}
			var sc config.MinIOConfig
			if err := sysConfigRepo.Get(ctx, "storage", &sc); err != nil {
				slog.Error("storage reload: failed to load config", "error", err)
				return
			}
			if err := storageMgr.Reload(ctx, sc); err != nil {
				slog.Error("storage reload failed", "error", err)
				return
			}
			slog.Info("storage backend reloaded", "endpoint", sc.Endpoint, "bucket", sc.Bucket)
		})
	}
	settingsResolver := service.NewSettingsResolver(assignmentRepo, domainRepo, orgRepo, cfg.Defaults)

	// SMTP components
	publisher := realtime.NewPublisher(rdb)
	router := smtp.NewRouter(domainRepo, inboxRepoRedis, inboxRepoPG)
	dispatcher := webhook.NewDispatcher(webhookRepo, cfg.Defaults.WebhookTimeout, cfg.Defaults.WebhookMaxRetries)
	auditRepo := postgres.NewAuditRepo(pool)
	auditSvc := service.NewAuditService(auditRepo)
	auditRec := audit.NewRecorder(auditSvc)
	handler := smtp.NewHandler(inboxRepoPG, inboxRepoRedis, emailRepo, assignmentRepo, dispatcher, nil, nil, attachmentSvc, settingsResolver, publisher, auditRec)
	server := smtp.NewServer(cfg.SMTP, handler)
	listener := smtp.NewListener(server, router)

	// Start the processing worker pool.
	go server.Start(ctx) //nolint:errcheck

	// Start the TCP listener.
	go func() {
		if err := listener.ListenAndServe(ctx, cfg.SMTP.Listen); err != nil {
			slog.Error("smtp listener error", "error", err)
			cancel()
		}
	}()

	slog.Info("smtpd started",
		"version", Version,
		"listen", cfg.SMTP.Listen,
		"hostname", cfg.SMTP.Hostname,
		"max_size", cfg.SMTP.MaxSize,
		"workers", cfg.SMTP.Workers,
		"queue_size", cfg.SMTP.QueueSize,
	)

	// Wait for shutdown signal or context cancellation.
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-done:
	case <-ctx.Done():
	}

	slog.Info("smtpd shutting down")
	cancel()
	slog.Info("smtpd stopped")
}
