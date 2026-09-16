package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"github.com/amjaradat01/burnerbyte/internal/audit"
	"github.com/amjaradat01/burnerbyte/internal/auth"
	"github.com/amjaradat01/burnerbyte/internal/auth/rbac"
	"github.com/amjaradat01/burnerbyte/internal/cfgsync"
	"github.com/amjaradat01/burnerbyte/internal/clientip"
	"github.com/amjaradat01/burnerbyte/internal/config"
	appcrypto "github.com/amjaradat01/burnerbyte/internal/crypto"
	"github.com/amjaradat01/burnerbyte/internal/database"
	"github.com/amjaradat01/burnerbyte/internal/handler"
	"github.com/amjaradat01/burnerbyte/internal/installer"
	"github.com/amjaradat01/burnerbyte/internal/mailer"
	mw "github.com/amjaradat01/burnerbyte/internal/middleware"
	"github.com/amjaradat01/burnerbyte/internal/realtime"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
	redisrepo "github.com/amjaradat01/burnerbyte/internal/repository/redis"
	"github.com/amjaradat01/burnerbyte/internal/service"
	"github.com/amjaradat01/burnerbyte/internal/storage"
	"github.com/amjaradat01/burnerbyte/internal/webhook"
	"github.com/amjaradat01/burnerbyte/internal/worker"
)

var Version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger := setupLogger(cfg.Logging)
	slog.SetDefault(logger)

	// First-run web installer: when no database is configured, serve a token-
	// gated installer that collects DB/Redis/secrets, writes config.yaml, and
	// re-execs into normal boot. An already-configured instance skips this.
	if installer.Needed(cfg) {
		if err := installer.Run(cfg); err != nil {
			slog.Error("installer failed", "error", err)
			os.Exit(1)
		}
		return
	}

	if len(cfg.JWT.Secret) < 32 {
		slog.Error("JWT secret must be at least 32 characters", "current_length", len(cfg.JWT.Secret))
		os.Exit(1)
	}
	// docker-compose.yml carries a development fallback long enough to clear
	// the length check above, so a deployment that never wrote a .env used to
	// boot happily on a signing key published in a public repository — and
	// anyone could then mint a token with is_system_admin set. Fail closed.
	if config.IsPublishedDefaultJWTSecret(cfg.JWT.Secret) {
		slog.Error("JWT secret is the development default published in docker-compose.yml; " +
			"anyone could forge an admin token. Set JWT_SECRET in .env to a random value " +
			"(openssl rand -hex 32) before starting.")
		os.Exit(1)
	}

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
	counterRepo := postgres.NewCounterRepo(pool)
	verHistoryRepo := postgres.NewVerificationHistoryRepo(pool)
	sysConfigRepo := postgres.NewSystemConfigRepo(pool)
	var enc *appcrypto.Encryptor
	if cfg.Encryption.Key != "" {
		var err error
		enc, err = appcrypto.NewEncryptor(cfg.Encryption.Key)
		if err != nil {
			slog.Error("invalid encryption key", "error", err)
			os.Exit(1)
		}
		sysConfigRepo.WithEncryptor(enc)
		slog.Info("encryption enabled for sensitive config values")
	} else {
		// No key: the repos fall back to storing secrets verbatim. The column is
		// named *_encrypted but would hold plaintext, so warn loudly — operators
		// shouldn't discover unprotected OAuth/SMTP/storage credentials only after
		// a database leak.
		slog.Warn("encryption key not set: SSO client secrets and other sensitive configuration (SMTP, object-storage credentials) are stored UNENCRYPTED in the database; set encryption.key to a 32-byte hex value (64 hex chars) to protect them at rest")
	}

	// SSO repositories
	ssoProviderRepo := postgres.NewSSOProviderRepo(pool, enc)
	ssoIdentityRepo := postgres.NewSSOIdentityRepo(pool)
	ssoDomainMappingRepo := postgres.NewSSODomainMappingRepo(pool)

	// Load runtime configs from DB (overrides config.yaml/env for mailer + storage)
	cfg.LoadFromDB(ctx, sysConfigRepo)
	ml.Reconfigure(cfg.Mailer)

	// Services
	// Object storage with a hot-swappable backend (Manager) so the admin storage
	// editor can reload S3 credentials at runtime. Falls back to the local
	// filesystem when MinIO is unavailable at boot.
	var storageBackend storage.Backend
	s3Client, err := storage.NewS3(ctx, cfg.MinIO)
	if err != nil {
		slog.Warn("minio unavailable, using local filesystem for attachments", "error", err)
		localFS, fsErr := storage.NewLocalFS("./data/attachments", cfg.Server.BaseURL+"/api/v1/files")
		if fsErr != nil {
			slog.Error("failed to create local storage", "error", fsErr)
		} else {
			storageBackend = localFS
			slog.Info("attachments enabled via local filesystem", "path", "./data/attachments")
		}
	} else {
		storageBackend = s3Client
	}
	var attachmentSvc *service.AttachmentService
	var storageMgr *storage.Manager
	if storageBackend != nil {
		storageMgr = storage.NewManager(storageBackend)
		attachmentSvc = service.NewAttachmentService(attachmentRepo, emailRepo, inboxRepo, storageMgr, cfg.MinIO, cfg.Defaults.MaxAttachmentSizeMB, cfg.Defaults.PresignedURLTTL)
		// Apply runtime storage-config changes (published by the admin editor in
		// this or another process) without a restart. Idempotent: the publisher
		// receives its own message too.
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
	sessionRevCache := auth.NewSessionRevocationCache(rdb, cfg.JWT.AccessTTL)
	authSvc := service.NewAuthService(pool, userRepo, sessionRepo, resetRepo, postgres.NewEmailVerificationRepo(pool), orgRepo, ssoIdentityRepo, ssoProviderRepo, teamRepo, ssoDomainMappingRepo, tokenMgr, lockout, ml, cfg, sessionRevCache, auth.NewPendingLoginStore(rdb, 5*time.Minute), auth.NewSSOCodeStore(rdb, 60*time.Second))
	orgSvc := service.NewOrgService(pool, orgRepo, teamRepo, userRepo, ssoProviderRepo, ml, cfg.Server.FrontendURL, cfg.Defaults.InviteExpiryTTL)
	redisInboxRepo := redisrepo.NewInboxRepo(rdb)
	domainSvc := service.NewDomainService(domainRepo, orgRepo, inboxRepo, redisInboxRepo, verHistoryRepo, cfg)
	teamSvc := service.NewTeamService(pool, teamRepo, orgRepo, userRepo, counterRepo, cfg)
	teamSvc.SetOrgService(orgSvc)
	assignmentSvc := service.NewDomainAssignmentService(assignmentRepo, domainRepo, orgRepo, cfg.Defaults)
	inboxSvc := service.NewInboxService(inboxRepo, redisInboxRepo, assignmentRepo, domainRepo, orgRepo, teamRepo, counterRepo, cfg)
	// Pass explicit nil interface when attachments are disabled to avoid
	// Go's nil-concrete-pointer-in-interface trap causing a panic on delete.
	var emailAttachmentCleaner service.AttachmentCleaner
	if attachmentSvc != nil {
		emailAttachmentCleaner = attachmentSvc
	}
	emailSvc := service.NewEmailService(emailRepo, inboxRepo, attachmentRepo, emailAttachmentCleaner)
	webhookSvc := service.NewWebhookService(webhookRepo)
	webhookDispatcher := webhook.NewDispatcher(webhookRepo, cfg.Defaults.WebhookTimeout, cfg.Defaults.WebhookMaxRetries)
	// Permission cache & RBAC
	roleRepo := postgres.NewRoleRepo(pool)
	roleAdapter := &roleRepoAdapter{repo: roleRepo}
	permCache, err := rbac.NewPermissionCache(ctx, roleAdapter)
	if err != nil {
		slog.Error("failed to initialize permission cache", "error", err)
		os.Exit(1)
	}
	apikeySvc := service.NewAPIKeyService(apikeyRepo, service.WithScopesProvider(permCache.TeamPermissionKeys))
	auditSvc := service.NewAuditService(auditRepo)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo)

	// RBAC & Audit
	rbac.SetDefaultCache(permCache)
	handler.InitRBAC(rbac.NewChecker(orgRepo, teamRepo, permCache))
	auditRecorder := audit.NewRecorder(auditSvc)
	handler.InitAudit(auditRecorder)
	handler.InitWebhookDispatch(webhookDispatcher)

	// WebSocket hubs
	hub := realtime.NewHub()
	notifHub := realtime.NewNotifHub()
	adminHub := realtime.NewAdminHub()
	notifRepo := postgres.NewNotificationRepo(pool)
	realtime.Subscribe(ctx, rdb, hub, notifHub, notifRepo, counterRepo)
	inboxEventPublisher := realtime.NewPublisher(rdb)

	// Handlers
	ssoMgr := auth.NewSSOManager(cfg, enc)
	// Load SSO providers from database at startup
	if dbProviders, err := ssoProviderRepo.ListEnabled(ctx); err == nil {
		ssoMgr.LoadProviders(ctx, dbProviders)
	} else {
		slog.Warn("failed to load SSO providers from database", "error", err)
		ssoMgr.LoadProviders(ctx, nil)
	}
	// The SSO link intent is held server-side against the state value rather
	// than in a client cookie; see internal/auth/sso_state.go.
	ssoStateStore := auth.NewSSOStateStore(rdb, 10*time.Minute)
	authHandler := handler.NewAuthHandler(authSvc, ssoMgr, cfg, ssoStateStore)
	orgHandler := handler.NewOrgHandler(orgSvc, userRepo)
	domainHandler := handler.NewDomainHandler(domainSvc, inboxRepo, cfg.SMTP.Hostname)
	teamHandler := handler.NewTeamHandler(teamSvc)
	assignmentHandler := handler.NewDomainAssignmentHandler(assignmentSvc, inboxRepo, teamSvc)
	inboxHandler := handler.NewInboxHandler(inboxSvc)
	emailHandler := handler.NewEmailHandler(emailSvc, attachmentSvc, inboxSvc)
	tryHandler := handler.NewTryHandler(inboxSvc, emailSvc, cfg)
	webhookHandler := handler.NewWebhookHandler(webhookSvc)
	apikeyHandler := handler.NewAPIKeyHandler(apikeySvc)
	auditHandler := handler.NewAuditHandler(auditSvc)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc, cfg.Defaults.AnalyticsDefaultDays)
	adminHandler := handler.NewAdminHandler(analyticsSvc, orgSvc, authSvc, sysConfigRepo, ssoProviderRepo, ssoDomainMappingRepo, teamRepo, ssoMgr, enc, cfg, pool, rdb, storageMgr, cfg.MinIO.Bucket, ml)
	setupHandler := handler.NewSetupHandler(pool, userRepo, orgRepo, domainRepo, teamRepo, sessionRepo, sysConfigRepo, tokenMgr, ml, cfg)
	wsHandler := handler.NewWSHandler(hub, inboxRepo, cfg.CORS.AllowedOrigins)
	notifWSHandler := handler.NewNotifWSHandler(notifHub, cfg.CORS.AllowedOrigins)
	adminWSHandler := handler.NewAdminWSHandler(adminHub, cfg.CORS.AllowedOrigins)

	// Auth middleware
	ticketResolver := auth.NewTicketResolver(rdb)
	authMw := auth.Middleware(tokenMgr, userRepo, apikeyRepo, sessionRevCache, ticketResolver)

	// Rate limiter
	rateLimiter := mw.NewRateLimiter(cfg.RateLimit)
	rateLimiter.WithRedis(rdb)

	// Client IP resolution. Deliberately NOT chi's middleware.RealIP: that
	// rewrites r.RemoteAddr from client-supplied headers with no trusted-proxy
	// check, which handed the /metrics gate, every rate limiter, the API-key IP
	// allowlist and the audit trail's source IP to the caller.
	clientIPs := clientip.New(cfg.RateLimit.TrustedProxies)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(clientIPs.Middleware)
	r.Use(requestLogger(logger))
	r.Use(chimw.Recoverer)
	r.Use(mw.SecurityHeaders)
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
		r.Handle(cfg.Metrics.Path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// clientip.From, not r.RemoteAddr: the caller must not be able to
			// name its own source address and read the metrics.
			parsed := net.ParseIP(clientip.From(r))
			if parsed == nil || (!parsed.IsLoopback() && !parsed.IsPrivate()) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			promhttp.Handler().ServeHTTP(w, r)
		}))
	}

	// API v1
	r.Route("/api/v1", func(r chi.Router) {
		// Public routes (no auth)
		setupHandler.Routes(r, rateLimiter)
		authHandler.PublicRoutes(r, rateLimiter)
		tryHandler.Routes(r, rateLimiter)
		r.Get("/invites/{token}/preview", orgHandler.PreviewInvite)

		// Roles (public — returns role definitions from DB)
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
			r.Post("/orgs/{orgId}/members/add", orgHandler.DirectAddMember)
			r.Get("/orgs/{orgId}/members", orgHandler.ListMembers)
			r.Get("/orgs/{orgId}/members/me", orgHandler.GetMyMembership)
			r.Get("/orgs/{orgId}/members/search", orgHandler.SearchMembers)
			r.Patch("/orgs/{orgId}/members/{userId}", orgHandler.ChangeRole)
			r.Post("/orgs/{orgId}/members/{userId}/deactivate", orgHandler.DeactivateUser)
			r.Post("/orgs/{orgId}/invites", orgHandler.InviteMember)
			r.Post("/orgs/{orgId}/invites/bulk", orgHandler.BulkInviteMembers)
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
			r.Get("/orgs/{orgId}/domains/{domainId}/impact", domainHandler.GetDomainImpact)
			r.Get("/orgs/{orgId}/domains/{domainId}/verification-history", domainHandler.GetVerificationHistory)
			r.With(auth.RequireSystemAdmin).Post("/orgs/{orgId}/domains/{domainId}/transfer", domainHandler.TransferDomain)
			r.Post("/orgs/{orgId}/domains/bulk-verify", domainHandler.BulkVerify)
			r.Post("/orgs/{orgId}/domains/bulk-delete", domainHandler.BulkDelete)

			// Teams
			r.Post("/orgs/{orgId}/teams", teamHandler.CreateTeam)
			r.Get("/orgs/{orgId}/teams", teamHandler.ListTeams)
			r.Get("/orgs/{orgId}/teams/{teamId}", teamHandler.GetTeam)
			r.Patch("/orgs/{orgId}/teams/{teamId}", teamHandler.UpdateTeam)
			r.Delete("/orgs/{orgId}/teams/{teamId}", teamHandler.DeleteTeam)
			r.Post("/orgs/{orgId}/teams/{teamId}/archive", teamHandler.ArchiveTeam)
			r.Post("/orgs/{orgId}/teams/{teamId}/restore", teamHandler.RestoreTeam)
			r.Get("/orgs/{orgId}/teams/{teamId}/impact", teamHandler.GetImpact)
			r.Post("/orgs/{orgId}/teams/{teamId}/leave", teamHandler.LeaveTeam)
			r.Post("/orgs/{orgId}/teams/{teamId}/members", teamHandler.AddMember)
			r.Get("/orgs/{orgId}/teams/{teamId}/members", teamHandler.ListMembers)
			r.Post("/orgs/{orgId}/teams/{teamId}/members/bulk-add", teamHandler.BulkAddMembers)
			r.Post("/orgs/{orgId}/teams/{teamId}/members/bulk-remove", teamHandler.BulkRemoveMembers)
			r.Patch("/orgs/{orgId}/teams/{teamId}/members/{userId}", teamHandler.ChangeRole)
			r.Delete("/orgs/{orgId}/teams/{teamId}/members/{userId}", teamHandler.RemoveMember)
			r.With(auth.RequireSystemAdmin).Post("/orgs/{orgId}/teams/{teamId}/transfer", teamHandler.TransferTeam)

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
			r.Get("/orgs/{orgId}/teams/{teamId}/webhooks/{webhookId}/stats", webhookHandler.WebhookStats)

			// API Keys
			r.Post("/orgs/{orgId}/teams/{teamId}/api-keys", apikeyHandler.Create)
			r.Get("/orgs/{orgId}/teams/{teamId}/api-keys", apikeyHandler.List)
			r.Get("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Get)
			r.Patch("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Update)
			r.Delete("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Revoke)
			r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}/rotate", apikeyHandler.Rotate)
			r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/bulk-revoke", apikeyHandler.BulkRevoke)

			// Analytics
			r.Get("/orgs/{orgId}/analytics", analyticsHandler.OrgAnalytics)
			r.Get("/orgs/{orgId}/analytics/emails-per-day", analyticsHandler.OrgEmailsPerDay)
			r.Get("/orgs/{orgId}/analytics/insights", analyticsHandler.OrgInsights)
			r.Get("/orgs/{orgId}/analytics/domain-series", analyticsHandler.OrgDomainTimeSeries)
			r.Get("/orgs/{orgId}/teams/{teamId}/analytics", analyticsHandler.TeamAnalytics)
			r.Get("/orgs/{orgId}/teams/{teamId}/analytics/emails-per-day", analyticsHandler.TeamEmailsPerDay)
			r.Get("/orgs/{orgId}/teams/{teamId}/analytics/insights", analyticsHandler.TeamInsights)

			// Audit
			r.Get("/orgs/{orgId}/audit", auditHandler.List)
			r.Get("/orgs/{orgId}/audit/export", auditHandler.Export)
			// Platform-level audit events (no owning org): system-admin only
			r.With(auth.RequireSystemAdmin).Get("/admin/audit", auditHandler.ListPlatform)

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
			r.With(auth.RequireSystemAdmin).Post("/admin/users/{userId}/migrate-auth", adminHandler.MigrateAuth)
			r.With(auth.RequireSystemAdmin).Get("/admin/health", adminHandler.Health)
			r.With(auth.RequireSystemAdmin).Post("/admin/infra/test-smtp", adminHandler.TestSMTP)
			r.With(auth.RequireSystemAdmin).Post("/admin/infra/test-storage", adminHandler.TestStorage)
			r.With(auth.RequireSystemAdmin).Get("/admin/config/mailer", adminHandler.GetMailerConfig)
			r.With(auth.RequireSystemAdmin).Put("/admin/config/mailer", adminHandler.UpdateMailerConfig)
			r.With(auth.RequireSystemAdmin).Get("/admin/config/storage", adminHandler.GetStorageConfig)
			r.With(auth.RequireSystemAdmin).Put("/admin/config/storage", adminHandler.UpdateStorageConfig)
			r.With(auth.RequireSystemAdmin).Get("/admin/platform", adminHandler.GetPlatformSettings)
			r.With(auth.RequireSystemAdmin).Put("/admin/platform", adminHandler.UpdatePlatformSettings)
			r.With(auth.RequireSystemAdmin).Get("/admin/sso/providers", adminHandler.ListSSOProviders)
			r.With(auth.RequireSystemAdmin).Post("/admin/sso/providers", adminHandler.CreateSSOProvider)
			r.With(auth.RequireSystemAdmin).Get("/admin/sso/providers/{providerId}", adminHandler.GetSSOProvider)
			r.With(auth.RequireSystemAdmin).Put("/admin/sso/providers/{providerId}", adminHandler.UpdateSSOProvider)
			r.With(auth.RequireSystemAdmin).Delete("/admin/sso/providers/{providerId}", adminHandler.DeleteSSOProvider)
			r.With(auth.RequireSystemAdmin).Post("/admin/sso/test", adminHandler.TestSSOConnection)
			r.With(auth.RequireSystemAdmin).Get("/admin/sso/providers/{providerId}/domain-mappings", adminHandler.ListDomainMappings)
			r.With(auth.RequireSystemAdmin).Post("/admin/sso/providers/{providerId}/domain-mappings", adminHandler.CreateDomainMapping)
			r.With(auth.RequireSystemAdmin).Put("/admin/sso/providers/{providerId}/domain-mappings/{mappingId}", adminHandler.UpdateDomainMapping)
			r.With(auth.RequireSystemAdmin).Delete("/admin/sso/providers/{providerId}/domain-mappings/{mappingId}", adminHandler.DeleteDomainMapping)
			r.With(auth.RequireSystemAdmin).Post("/admin/sso/domain-mappings/preview", adminHandler.PreviewDomainMapping)
			r.With(auth.RequireSystemAdmin).Get("/admin/version", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"version": Version})
			})
			r.With(auth.RequireSystemAdmin).Delete("/admin/users/{userId}/sessions", func(w http.ResponseWriter, r *http.Request) {
				userID, err := uuid.Parse(chi.URLParam(r, "userId"))
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid user ID"})
					return
				}
				// Fetch target user info for audit
				targetUser, _ := authSvc.GetMe(r.Context(), userID)
				targetEmail := ""
				targetDisplayName := ""
				if targetUser != nil {
					targetEmail = targetUser.Email
					targetDisplayName = targetUser.DisplayName
				}
				if err := sessionRepo.RevokeAllByUser(r.Context(), userID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to revoke sessions"})
					return
				}
				// Mark revocation for immediate access token invalidation
				sessionRevCache.MarkRevoked(r.Context(), userID)
				handler.Audit.RecordEnhanced(r, uuid.Nil, "admin.sessions_revoked", "user", userID, targetEmail, map[string]any{"target_user_id": userID.String(), "email": targetEmail, "display_name": targetDisplayName})
				w.WriteHeader(http.StatusNoContent)
			})

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

				// Fetch role before update for diffs
				var beforeLabel, beforeDesc string
				var beforePerms []string
				if oldRole, err := roleRepo.GetRole(r.Context(), roleID); err == nil && oldRole != nil {
					beforeLabel = oldRole.Label
					beforeDesc = oldRole.Description
					beforePerms = oldRole.Permissions
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
					// Refresh permission cache after role permission changes
					if err := handler.RBAC.RefreshCache(r.Context()); err != nil {
						slog.Error("failed to refresh permission cache", "error", err)
					}
				}

				afterLabel := input.Label
				if afterLabel == "" {
					afterLabel = beforeLabel
				}
				afterDesc := input.Description
				if afterDesc == "" {
					afterDesc = beforeDesc
				}
				afterPerms := input.Permissions
				if afterPerms == nil {
					afterPerms = beforePerms
				}

				handler.Audit.RecordEnhanced(r, uuid.Nil, "admin.role_updated", "role", roleID, input.Label, map[string]any{
					"role_id": roleID.String(), "label": input.Label, "description": input.Description, "permissions": input.Permissions,
					"before": map[string]any{"label": beforeLabel, "description": beforeDesc, "permissions": beforePerms},
					"after":  map[string]any{"label": afterLabel, "description": afterDesc, "permissions": afterPerms},
				})
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
					// Refresh permission cache after new role with permissions
					if err := handler.RBAC.RefreshCache(r.Context()); err != nil {
						slog.Error("failed to refresh permission cache", "error", err)
					}
				}
				handler.Audit.RecordEnhanced(r, uuid.Nil, "admin.role_created", "role", role.ID, input.Label, map[string]any{
					"scope": input.Scope, "value": input.Value, "label": input.Label, "permissions": input.Permissions,
				})
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
				handler.Audit.RecordEnhanced(r, uuid.Nil, "admin.role_deleted", "role", roleID, roleID.String(), map[string]any{
					"role_id": roleID.String(),
				})
				w.WriteHeader(http.StatusNoContent)
			})

			// Notifications
			r.Get("/notifications", func(w http.ResponseWriter, r *http.Request) {
				uc := r.Context().Value(auth.UserContextKey).(*auth.UserContext)
				list, err := notifRepo.ListByUser(r.Context(), uc.UserID, 50)
				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to list notifications"})
					return
				}
				if list == nil {
					list = []postgres.Notification{}
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(list)
			})
			r.Post("/notifications/mark-all-read", func(w http.ResponseWriter, r *http.Request) {
				uc := r.Context().Value(auth.UserContextKey).(*auth.UserContext)
				if err := notifRepo.MarkAllRead(r.Context(), uc.UserID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to mark all read"})
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"message": "ok"})
			})
			r.Patch("/notifications/{notifId}/read", func(w http.ResponseWriter, r *http.Request) {
				uc := r.Context().Value(auth.UserContextKey).(*auth.UserContext)
				id, err := uuid.Parse(chi.URLParam(r, "notifId"))
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid notification ID"})
					return
				}
				if err := notifRepo.MarkRead(r.Context(), id, uc.UserID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed to mark read"})
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"message": "ok"})
			})

			r.Delete("/notifications", func(w http.ResponseWriter, r *http.Request) {
				uc := auth.GetUser(r.Context())
				if err := notifRepo.DeleteAll(r.Context(), uc.UserID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed"})
					return
				}
				handler.Audit.RecordEnhanced(r, uuid.Nil, "notification.all_deleted", "notification", uuid.Nil, "", map[string]any{})
				w.WriteHeader(http.StatusNoContent)
			})

			r.Delete("/notifications/{notifId}", func(w http.ResponseWriter, r *http.Request) {
				uc := r.Context().Value(auth.UserContextKey).(*auth.UserContext)
				id, err := uuid.Parse(chi.URLParam(r, "notifId"))
				if err != nil {
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]string{"error": "invalid id"})
					return
				}
				if err := notifRepo.Delete(r.Context(), id, uc.UserID); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "failed"})
					return
				}
				handler.Audit.RecordEnhanced(r, uuid.Nil, "notification.deleted", "notification", id, "", map[string]any{"notification_id": id.String()})
				w.WriteHeader(http.StatusNoContent)
			})

			// File serving for local attachment storage.
			r.Get("/files", func(w http.ResponseWriter, r *http.Request) {
				uc := auth.GetUser(r.Context())
				if uc == nil {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				key := r.URL.Query().Get("key")
				if key == "" {
					http.Error(w, "missing key", http.StatusBadRequest)
					return
				}
				base, _ := filepath.Abs("./data/attachments")
				resolved, _ := filepath.Abs(filepath.Join(base, filepath.Clean(key)))
				if !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
					http.Error(w, "invalid path", http.StatusBadRequest)
					return
				}
				// Authorize: this endpoint has no URL signature or expiry, so the
				// key alone is not a capability. Confirm the caller owns the
				// attachment before serving, or any logged-in user could read any
				// file by key (IDOR). Respond 404 on failure to avoid disclosing
				// which keys exist.
				if attachmentSvc == nil || attachmentSvc.AuthorizeKeyAccess(r.Context(), key, uc.UserID) != nil {
					http.Error(w, "not found", http.StatusNotFound)
					return
				}
				data, err := os.ReadFile(resolved)
				if err != nil {
					http.Error(w, "not found", http.StatusNotFound)
					return
				}
				w.Header().Set("Content-Disposition", "attachment")
				w.Header().Set("Content-Type", "application/octet-stream")
				w.Write(data)
			})

			// WebSocket ticket endpoint - generates a short-lived ticket for WS auth
			r.Post("/ws/ticket", func(w http.ResponseWriter, r *http.Request) {
				uc := auth.GetUser(r.Context())
				if uc == nil {
					// Unreachable inside the authenticated group, but the
					// dereference below is one route-move from a panic.
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				ticket := uuid.New().String()
				rdb.Set(r.Context(), "ws_ticket:"+ticket, uc.UserID.String(), 30*time.Second)
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"ticket": ticket})
			})

			// WebSocket
			r.Get("/ws/inboxes/{inboxId}", wsHandler.InboxWS)
			r.Get("/ws/notifications", notifWSHandler.NotificationsWS)
			r.Get("/ws/admin-stats", adminWSHandler.AdminStatsWS)
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
	wm.Add("cleanup", cfg.Workers.CleanupInterval, worker.CleanupJob(inboxRepo, emailRepo, attachmentSvc, sessionRepo, resetRepo, apikeyRepo, webhookDispatcher, auditRecorder, inboxEventPublisher))
	wm.Add("reconciler", cfg.Workers.ReconcilerInterval, worker.ReconcilerJob(inboxRepo, redisInboxRepo))
	wm.Add("dns_recheck", cfg.Workers.DNSRecheckInterval, worker.DNSRecheckJob(domainRepo, verHistoryRepo, cfg.SMTP.Hostname))
	wm.Add("webhook_retry", cfg.Workers.WebhookRetryInterval, worker.WebhookRetryJob(webhookRepo, webhookDispatcher))
	wm.Add("analytics", cfg.Workers.AnalyticsInterval, worker.AnalyticsJob(analyticsRepo, rdb, cfg.Defaults.AnalyticsCacheTTL))
	wm.Add("invite_expiry", 24*time.Hour, worker.InviteExpiryJob(orgRepo, userRepo, ml, cfg.Server.FrontendURL))
	wm.Add("admin_stats", 10*time.Second, worker.AdminStatsJob(analyticsRepo, adminHub))
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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	// Drain HTTP connections first.
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	hub.CloseAll()
	notifHub.CloseAll()
	adminHub.CloseAll()
	rateLimiter.Stop()

	// Stop background workers and wait for in-flight jobs.
	workerCancel()

	slog.Info("api server stopped")
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

// readyz reports readiness per dependency. Both are probed even when the first
// fails: returning early hid which one was actually down, and the setup
// wizard's infrastructure panel reads the individual `postgres` and `redis`
// fields to show them separately. `status` is retained for existing callers.
func readyz(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		body := map[string]string{"postgres": "ok", "redis": "ok", "status": "ok"}
		var failed []string

		if err := pool.Ping(ctx); err != nil {
			body["postgres"] = "error"
			failed = append(failed, "database unavailable")
		}
		if err := rdb.Ping(ctx).Err(); err != nil {
			body["redis"] = "error"
			failed = append(failed, "redis unavailable")
		}

		code := http.StatusOK
		if len(failed) > 0 {
			body["status"] = "error"
			body["detail"] = strings.Join(failed, "; ")
			code = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(body)
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
				"remote_addr", clientip.From(r),
			)
		})
	}
}

// roleRepoAdapter adapts postgres.RoleRepo to the rbac.RolePermissionRepo interface.
type roleRepoAdapter struct {
	repo *postgres.RoleRepo
}

func (a *roleRepoAdapter) ListRoles(ctx context.Context, scope string) ([]rbac.Role, error) {
	pgRoles, err := a.repo.ListRoles(ctx, scope)
	if err != nil {
		return nil, err
	}
	roles := make([]rbac.Role, len(pgRoles))
	for i, r := range pgRoles {
		roles[i] = rbac.Role{
			Value:       r.Value,
			Rank:        r.Rank,
			Permissions: r.Permissions,
		}
	}
	return roles, nil
}
