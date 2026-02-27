package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	slog.Info("smtpd starting",
		"listen", cfg.SMTP.Listen,
		"hostname", cfg.SMTP.Hostname,
	)

	// SMTP server setup will be implemented in feature/010-smtp-server
	// This entrypoint establishes the binary and graceful shutdown pattern

	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)

	<-done
	slog.Info("smtpd shutting down")
}
