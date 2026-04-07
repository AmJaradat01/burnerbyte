package main

import (
	"context"
	"encoding/json"
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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/audit"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	appcrypto "gitlab.com/burnerbyte/burnerbyte/internal/crypto"
	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/handler"
	"gitlab.com/burnerbyte/burnerbyte/internal/mailer"
	mw "gitlab.com/burnerbyte/burnerbyte/internal/middleware"
	"gitlab.com/burnerbyte/burnerbyte/internal/realtime"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	redisrepo "gitlab.com/burnerbyte/burnerbyte/internal/repository/redis"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
	"gitlab.com/burnerbyte/burnerbyte/internal/storage"
	"gitlab.com/burnerbyte/burnerbyte/internal/webhook"
	"gitlab.com/burnerbyte/burnerbyte/internal/worker"
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
	defer rdb.Close() //nolint:errcheck

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
	sysConfigRepo := postgres.NewSystemConfigRepo(pool)
	if cfg.Encryption.Key != "" {
		enc, err := appcrypto.NewEncryptor(cfg.Encryption.Key)
		if err != nil {
			slog.Error("invalid encryption key", "error", err)
			os.Exit(1)
		}
		sysConfigRepo.WithEncryptor(enc)
		slog.Info("encryption enabled for sensitive config values")
	}

	// Load runtime configs from DB (overrides config.yaml/env for mailer + storage)
	cfg.LoadFromDB(ctx, sysConfigRepo)
	ml.Reconfigure(cfg.Mailer)

	// Services
	s3Client, err := storage.NewS3(ctx, cfg.MinIO)
	if err != nil {
		slog.Warn("minio unavailable, attachments disabled", "error", err)
	}
	var attachmentSvc *service.AttachmentService
	if s3Client != nil {
		attachmentSvc = service.NewAttachmentService(attachmentRepo, emailRepo, inboxRepo, s3Client, cfg.MinIO, cfg.Defaults.MaxAttachmentSizeMB, cfg.Defaults.PresignedURLTTL)
	}
	authSvc := service.NewAuthService(pool, userRepo, sessionRepo, resetRepo, postgres.NewEmailVerificationRepo(pool), orgRepo, tokenMgr, lockout, ml, cfg)
	orgSvc := service.NewOrgService(pool, orgRepo, ml, cfg.Server.FrontendURL, cfg.Defaults.InviteExpiryTTL)
	redisInboxRepo := redisrepo.NewInboxRepo(rdb)
	domainSvc := service.NewDomainService(domainRepo, orgRepo, inboxRepo, redisInboxRepo, cfg)
	teamSvc := service.NewTeamService(pool, teamRepo, orgRepo, userRepo, cfg)
	assignmentSvc := service.NewDomainAssignmentService(assignmentRepo, domainRepo, orgRepo, cfg.Defaults)
	inboxSvc := service.NewInboxService(inboxRepo, redisInboxRepo, assignmentRepo, domainRepo, orgRepo, teamRepo, cfg)
	// Pass explicit nil interface when attachments are disabled to avoid
	// Go's nil-concrete-pointer-in-interface trap causing a panic on delete.
	var emailAttachmentCleaner service.AttachmentCleaner
	if attachmentSvc != nil {
		emailAttachmentCleaner = attachmentSvc
	}
	emailSvc := service.NewEmailService(emailRepo, inboxRepo, attachmentRepo, emailAttachmentCleaner)
	webhookSvc := service.NewWebhookService(webhookRepo)
	webhookDispatcher := webhook.NewDispatcher(webhookRepo, cfg.Defaults.WebhookTimeout, cfg.Defaults.WebhookMaxRetries)
	apikeySvc := service.NewAPIKeyService(apikeyRepo)
	auditSvc := service.NewAuditService(auditRepo)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)

	// RBAC & Audit
	handler.InitRBAC(rbac.NewChecker(orgRepo, teamRepo))
	handler.InitAudit(audit.NewRecorder(auditSvc))
	handler.InitWebhookDispatch(webhookDispatcher)

	// WebSocket hubs
	hub := realtime.NewHub()
	notifHub := realtime.NewNotifHub()
	realtime.Subscribe(ctx, rdb, hub, notifHub)

	// Handlers
	ssoMgr := auth.NewSSOManager(cfg)
	authHandler := handler.NewAuthHandler(authSvc, ssoMgr, cfg)
	orgHandler := handler.NewOrgHandler(orgSvc)
	domainHandler := handler.NewDomainHandler(domainSvc, cfg.SMTP.Hostname)
	teamHandler := handler.NewTeamHandler(teamSvc)
	assignmentHandler := handler.NewDomainAssignmentHandler(assignmentSvc)
	inboxHandler := handler.NewInboxHandler(inboxSvc)
	emailHandler := handler.NewEmailHandler(emailSvc, attachmentSvc)
	webhookHandler := handler.NewWebhookHandler(webhookSvc)
	apikeyHandler := handler.NewAPIKeyHandler(apikeySvc)
	auditHandler := handler.NewAuditHandler(auditSvc)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc, cfg.Defaults.AnalyticsDefaultDays)
	adminHandler := handler.NewAdminHandler(analyticsSvc, orgSvc, authSvc, sysConfigRepo, cfg, pool, rdb, s3Client, cfg.MinIO.Bucket)
	setupHandler := handler.NewSetupHandler(pool, userRepo, orgRepo, domainRepo, teamRepo, sessionRepo, sysConfigRepo, tokenMgr, ml, cfg)
	wsHandler := handler.NewWSHandler(hub, inboxRepo, cfg.CORS.AllowedOrigins)
	notifWSHandler := handler.NewNotifWSHandler(notifHub, cfg.CORS.AllowedOrigins)

	// Auth middleware
	authMw := auth.Middleware(tokenMgr, userRepo, apikeyRepo)

	// Rate limiter
	rateLimiter := mw.NewRateLimiter(cfg.RateLimit)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(requestLogger(logger))
	r.Use(chimw.Recoverer)
	maxBody := cfg.Server.MaxBodySize
	if maxBody <= 0 {
		maxBody = 1 << 20 // 1 MB default
	}
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBody)
			next.ServeHTTP(w, r)
		})
	})
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
		authHandler.PublicRoutes(r, rateLimiter)
		r.Get("/invites/{token}/preview", orgHandler.PreviewInvite)

		// Roles (public — returns role definitions from DB)
		roleRepo := postgres.NewRoleRepo(pool)
		r.Get("/roles", func(w http.ResponseWriter, r *http.Request) {
			orgRoles, _ := roleRepo.ListRoles(r.Context(), "org")
			teamRoles, _ := roleRepo.ListRoles(r.Context(), "team")
			orgPerms, _ := roleRepo.ListPermissions(r.Context(), "org")
			teamPerms, _ := roleRepo.ListPermissions(r.Context(), "team")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"org_roles":        orgRoles,
				"team_roles":       teamRoles,
				"org_permissions":  orgPerms,
				"team_permissions": teamPerms,
			})
		})

		// Docs (public)
		r.Get("/docs", handler.SwaggerUI)
		r.Get("/docs/openapi.json", handler.OpenAPISpec)

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(authMw)
			r.Use(rateLimiter.Middleware)

			// Auth (authenticated)
			authHandler.AuthenticatedRoutes(r)

			// Orgs
			r.With(auth.RequireSystemAdmin).Post("/orgs", orgHandler.CreateOrg)
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
			r.Get("/orgs/{orgId}/invites", orgHandler.ListPendingInvites)
			r.Delete("/orgs/{orgId}/invites/{inviteId}", orgHandler.RevokeInvite)
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
			r.Get("/my/domains", assignmentHandler.ListMyDomains)
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
			r.Get("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}/deliveries", webhookHandler.ListDeliveryLogs)

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
			r.Post("/inboxes/{inboxId}/emails/mark-all-read", emailHandler.MarkAllRead)
			r.Get("/emails/{emailId}", emailHandler.GetEmail)
			r.Patch("/emails/{emailId}", emailHandler.MarkReadUnread)
			r.Delete("/emails/{emailId}", emailHandler.DeleteEmail)
			r.Get("/emails/{emailId}/attachments/{attachmentId}", emailHandler.DownloadAttachment)

			// Admin
			r.With(auth.RequireSystemAdmin).Get("/admin/stats", adminHandler.Stats)
			r.With(auth.RequireSystemAdmin).Get("/admin/orgs", adminHandler.ListOrgs)
			r.With(auth.RequireSystemAdmin).Get("/admin/users", adminHandler.ListUsers)
			r.With(auth.RequireSystemAdmin).Delete("/admin/users/{userId}", adminHandler.DeleteUser)
			r.With(auth.RequireSystemAdmin).Patch("/admin/users/{userId}", adminHandler.UpdateUser)
			r.With(auth.RequireSystemAdmin).Get("/admin/health", adminHandler.Health)
			r.With(auth.RequireSystemAdmin).Get("/admin/platform", adminHandler.GetPlatformSettings)
			r.With(auth.RequireSystemAdmin).Put("/admin/platform", adminHandler.UpdatePlatformSettings)
			r.With(auth.RequireSystemAdmin).Get("/admin/sso", adminHandler.GetSSOConfig)
			r.With(auth.RequireSystemAdmin).Put("/admin/sso", adminHandler.UpdateSSOConfig)

			// Role management (admin only)
			r.With(auth.RequireSystemAdmin).Patch("/admin/roles/{roleId}", func(w http.ResponseWriter, r *http.Request) {
				roleID, err := uuid.Parse(chi.URLParam(r, "roleId"))
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid role ID"})
					return
				}
				var input struct {
					Label       string   `json:"label"`
					Description string   `json:"description"`
					Permissions []string `json:"permissions"`
				}
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
					return
				}
				if input.Label != "" || input.Description != "" {
					if err := roleRepo.UpdateRole(r.Context(), roleID, input.Label, input.Description); err != nil {
						w.WriteHeader(http.StatusInternalServerError)
						json.NewEncoder(w).Encode(map[string]string{"error": "failed to update role"})
						return
					}
				}
				if input.Permissions != nil {
					if err := roleRepo.SetRolePermissions(r.Context(), roleID, input.Permissions); err != nil {
						w.WriteHeader(http.StatusInternalServerError)
						json.NewEncoder(w).Encode(map[string]string{"error": "failed to update permissions"})
						return
					}
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"message": "role updated"})
			})

			r.With(auth.RequireSystemAdmin).Post("/admin/roles", func(w http.ResponseWriter, r *http.Request) {
				var input struct {
					Scope       string   `json:"scope"`
					Value       string   `json:"value"`
					Label       string   `json:"label"`
					Description string   `json:"description"`
					Rank        int      `json:"rank"`
					Permissions []string `json:"permissions"`
				}
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
					return
				}
				if input.Scope != "org" && input.Scope != "team" {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "scope must be org or team"})
					return
				}
				if input.Value == "" || input.Label == "" {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "value and label are required"})
					return
				}
				role := &postgres.Role{ID: uuid.New(), Scope: input.Scope, Value: input.Value, Label: input.Label, Description: input.Description, Rank: input.Rank, IsSystem: false}
				if err := roleRepo.CreateRole(r.Context(), role); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to create role (value may already exist)"})
					return
				}
				if len(input.Permissions) > 0 {
					_ = roleRepo.SetRolePermissions(r.Context(), role.ID, input.Permissions)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(role)
			})

			r.With(auth.RequireSystemAdmin).Delete("/admin/roles/{roleId}", func(w http.ResponseWriter, r *http.Request) {
				roleID, err := uuid.Parse(chi.URLParam(r, "roleId"))
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid role ID"})
					return
				}
				if err := roleRepo.DeleteRole(r.Context(), roleID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to delete role"})
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"message": "role deleted"})
			})

			// WebSocket
			r.Get("/ws/inboxes/{inboxId}", wsHandler.InboxWS)
			r.Get("/ws/notifications", notifWSHandler.NotificationsWS)
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

	// Background workers
	workerCtx, workerCancel := context.WithCancel(context.Background())
	wm := worker.NewManager()
	wm.Add("cleanup", cfg.Workers.CleanupInterval, worker.CleanupJob(inboxRepo, emailRepo, attachmentSvc, sessionRepo, resetRepo))
	wm.Add("reconciler", cfg.Workers.ReconcilerInterval, worker.ReconcilerJob(inboxRepo, redisInboxRepo))
	wm.Add("dns_recheck", cfg.Workers.DNSRecheckInterval, worker.DNSRecheckJob(domainRepo, cfg.SMTP.Hostname))
	wm.Add("webhook_retry", cfg.Workers.WebhookRetryInterval, worker.WebhookRetryJob(webhookRepo, webhookDispatcher))
	wm.Add("analytics", cfg.Workers.AnalyticsInterval, worker.AnalyticsJob(analyticsRepo, rdb, cfg.Defaults.AnalyticsCacheTTL))
	go wm.Start(workerCtx)

	go func() {
		slog.Info("api server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down api server")
	workerCancel()
	hub.CloseAll()
	notifHub.CloseAll()
	rateLimiter.Stop()

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
