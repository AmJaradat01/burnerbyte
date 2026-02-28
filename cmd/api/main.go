package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/handler"
	"gitlab.com/amjaradat01/burnerbyte/internal/mailer"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/amjaradat01/burnerbyte/internal/repository/redis"
	"gitlab.com/amjaradat01/burnerbyte/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger := setupLogger(cfg.Logging)
	slog.SetDefault(logger)

	ctx := context.Background()

	// Database connections
	pool, err := database.NewPostgres(ctx, cfg.Database)
	if err != nil {
		slog.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb, err := database.NewRedis(ctx, cfg.Redis)
	if err != nil {
		slog.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Mailer
	ml, err := mailer.New(cfg.Mailer)
	if err != nil {
		slog.Error("failed to init mailer", "error", err)
		os.Exit(1)
	}

	// Auth components
	tokenMgr := auth.NewTokenManager(cfg.JWT)
	lockout := auth.NewLockout(rdb, cfg.Lockout.MaxAttempts, cfg.Lockout.Duration)

	// Repositories
	userRepo := postgres.NewUserRepo(pool)
	sessionRepo := postgres.NewSessionRepo(pool)
	resetRepo := postgres.NewPasswordResetRepo(pool)
	orgRepo := postgres.NewOrgRepo(pool)
	domainRepo := postgres.NewDomainRepo(pool)
	teamRepo := postgres.NewTeamRepo(pool)
	assignmentRepo := postgres.NewDomainAssignmentRepo(pool)
	inboxRepo := postgres.NewInboxRepo(pool)
	emailRepo := postgres.NewEmailRepo(pool)
	attachmentRepo := postgres.NewAttachmentRepo(pool)
	webhookRepo := postgres.NewWebhookRepo(pool)
	apikeyRepo := postgres.NewAPIKeyRepo(pool)
	auditRepo := postgres.NewAuditRepo(pool)
	analyticsRepo := postgres.NewAnalyticsRepo(pool)

	// Services
	authSvc := service.NewAuthService(pool, userRepo, sessionRepo, resetRepo, tokenMgr, lockout, ml, cfg)
	orgSvc := service.NewOrgService(pool, orgRepo, ml, cfg.Server.FrontendURL)
	domainSvc := service.NewDomainService(domainRepo, orgRepo, cfg)
	teamSvc := service.NewTeamService(pool, teamRepo, orgRepo, cfg)
	assignmentSvc := service.NewDomainAssignmentService(assignmentRepo, domainRepo)
	redisInboxRepo := redisrepo.NewInboxRepo(rdb)
	inboxSvc := service.NewInboxService(inboxRepo, redisInboxRepo, assignmentRepo, domainRepo, orgRepo, cfg)
	emailSvc := service.NewEmailService(emailRepo, inboxRepo)
	webhookSvc := service.NewWebhookService(webhookRepo)
	apikeySvc := service.NewAPIKeyService(apikeyRepo)
	auditSvc := service.NewAuditService(auditRepo)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)
	_ = attachmentRepo // Used via attachment service when S3 is configured

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc)
	orgHandler := handler.NewOrgHandler(orgSvc)
	domainHandler := handler.NewDomainHandler(domainSvc)
	teamHandler := handler.NewTeamHandler(teamSvc)
	assignmentHandler := handler.NewDomainAssignmentHandler(assignmentSvc)
	inboxHandler := handler.NewInboxHandler(inboxSvc)
	emailHandler := handler.NewEmailHandler(emailSvc)
	webhookHandler := handler.NewWebhookHandler(webhookSvc)
	apikeyHandler := handler.NewAPIKeyHandler(apikeySvc)
	auditHandler := handler.NewAuditHandler(auditSvc)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc)
	adminHandler := handler.NewAdminHandler(analyticsSvc)
	setupHandler := handler.NewSetupHandler(pool, userRepo, orgRepo, domainRepo, teamRepo, sessionRepo, tokenMgr, ml, cfg)

	// Auth middleware
	authMw := auth.Middleware(tokenMgr, userRepo)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(requestLogger(logger))
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.AllowedOrigins,
		AllowedMethods:   cfg.CORS.AllowedMethods,
		AllowedHeaders:   cfg.CORS.AllowedHeaders,
		AllowCredentials: true,
		MaxAge:           cfg.CORS.MaxAge,
	}))

	// Health & metrics
	r.Get("/healthz", healthz)
	r.Get("/readyz", readyz(pool, rdb))
	if cfg.Metrics.Enabled {
		r.Handle(cfg.Metrics.Path, promhttp.Handler())
	}

	// API v1
	r.Route("/api/v1", func(r chi.Router) {
		// Public routes (no auth)
		setupHandler.Routes(r)
		authHandler.PublicRoutes(r)

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(authMw)

			// Auth (authenticated)
			authHandler.AuthenticatedRoutes(r)

			// Orgs
			r.Post("/orgs", orgHandler.CreateOrg)
			r.Get("/orgs", orgHandler.ListOrgs)
			r.Get("/orgs/{orgId}", orgHandler.GetOrg)
			r.Patch("/orgs/{orgId}", orgHandler.UpdateOrg)
			r.Delete("/orgs/{orgId}", orgHandler.DeleteOrg)
			r.Get("/orgs/{orgId}/settings", orgHandler.GetSettings)
			r.Patch("/orgs/{orgId}/settings", orgHandler.UpdateSettings)
			r.Put("/orgs/{orgId}/settings", orgHandler.UpdateSettings)
			r.Post("/orgs/{orgId}/members", orgHandler.InviteMember)
			r.Get("/orgs/{orgId}/members", orgHandler.ListMembers)
			r.Patch("/orgs/{orgId}/members/{userId}", orgHandler.ChangeRole)
			r.Delete("/orgs/{orgId}/members/{userId}", orgHandler.RemoveMember)
			r.Post("/orgs/{orgId}/invites", orgHandler.InviteMember)
			r.Post("/invites/{token}/accept", orgHandler.AcceptInvite)

			// Domains
			r.Post("/orgs/{orgId}/domains", domainHandler.CreateDomain)
			r.Get("/orgs/{orgId}/domains", domainHandler.ListDomains)
			r.Get("/orgs/{orgId}/domains/{domainId}", domainHandler.GetDomain)
			r.Patch("/orgs/{orgId}/domains/{domainId}", domainHandler.UpdateDomain)
			r.Delete("/orgs/{orgId}/domains/{domainId}", domainHandler.DeleteDomain)
			r.Post("/orgs/{orgId}/domains/{domainId}/verify", domainHandler.VerifyDomain)

			// Teams
			r.Post("/orgs/{orgId}/teams", teamHandler.CreateTeam)
			r.Get("/orgs/{orgId}/teams", teamHandler.ListTeams)
			r.Get("/orgs/{orgId}/teams/{teamId}", teamHandler.GetTeam)
			r.Patch("/orgs/{orgId}/teams/{teamId}", teamHandler.UpdateTeam)
			r.Delete("/orgs/{orgId}/teams/{teamId}", teamHandler.DeleteTeam)
			r.Post("/orgs/{orgId}/teams/{teamId}/members", teamHandler.AddMember)
			r.Get("/orgs/{orgId}/teams/{teamId}/members", teamHandler.ListMembers)
			r.Patch("/orgs/{orgId}/teams/{teamId}/members/{userId}", teamHandler.ChangeRole)
			r.Delete("/orgs/{orgId}/teams/{teamId}/members/{userId}", teamHandler.RemoveMember)

			// Domain assignments
			r.Post("/orgs/{orgId}/teams/{teamId}/domains", assignmentHandler.AssignDomain)
			r.Get("/orgs/{orgId}/teams/{teamId}/domains", assignmentHandler.ListAssignments)
			r.Patch("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", assignmentHandler.UpdateAssignment)
			r.Delete("/orgs/{orgId}/teams/{teamId}/domains/{domainId}", assignmentHandler.Unassign)

			// Team-scoped inboxes
			r.Get("/orgs/{orgId}/teams/{teamId}/inboxes", inboxHandler.ListInboxes)

			// Webhooks
			r.Post("/orgs/{orgId}/teams/{teamId}/webhooks", webhookHandler.Create)
			r.Get("/orgs/{orgId}/teams/{teamId}/webhooks", webhookHandler.List)
			r.Patch("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", webhookHandler.Update)
			r.Delete("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}", webhookHandler.Delete)

			// API Keys
			r.Post("/orgs/{orgId}/teams/{teamId}/api-keys", apikeyHandler.Create)
			r.Get("/orgs/{orgId}/teams/{teamId}/api-keys", apikeyHandler.List)
			r.Delete("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Revoke)

			// Analytics
			r.Get("/orgs/{orgId}/analytics", analyticsHandler.OrgAnalytics)
			r.Get("/orgs/{orgId}/analytics/emails-per-day", analyticsHandler.OrgEmailsPerDay)
			r.Get("/orgs/{orgId}/teams/{teamId}/analytics", analyticsHandler.TeamAnalytics)
			r.Get("/orgs/{orgId}/teams/{teamId}/analytics/emails-per-day", analyticsHandler.TeamEmailsPerDay)

			// Audit
			r.Get("/orgs/{orgId}/audit", auditHandler.List)

			// User-scoped inboxes
			r.Get("/inboxes", inboxHandler.ListMyInboxes)
			r.Post("/inboxes", inboxHandler.CreateInboxFlat)
			r.Get("/inboxes/{inboxId}", inboxHandler.GetInbox)
			r.Delete("/inboxes/{inboxId}", inboxHandler.DeleteInbox)
			r.Post("/inboxes/{inboxId}/extend", inboxHandler.ExtendTTL)

			// Emails
			r.Get("/inboxes/{inboxId}/emails", emailHandler.ListEmails)
			r.Get("/emails/{emailId}", emailHandler.GetEmail)
			r.Patch("/emails/{emailId}", emailHandler.MarkReadUnread)
			r.Delete("/emails/{emailId}", emailHandler.DeleteEmail)

			// Admin
			r.Get("/admin/stats", adminHandler.Stats)
		})
	})

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("api server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down api server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}
	slog.Info("api server stopped")
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func readyz(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(ctx); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"error","detail":"database unavailable"}`))
			return
		}

		if err := rdb.Ping(ctx).Err(); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"error","detail":"redis unavailable"}`))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}
}

func setupLogger(cfg config.LoggingConfig) *slog.Logger {
	var level slog.Level
	switch cfg.Level {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if cfg.Format == "text" {
		h = slog.NewTextHandler(os.Stdout, opts)
	} else {
		h = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(h)
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", chimw.GetReqID(r.Context()),
				"remote_addr", r.RemoteAddr,
			)
		})
	}
}
