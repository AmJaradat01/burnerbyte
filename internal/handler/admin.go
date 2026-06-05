package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	appcrypto "gitlab.com/burnerbyte/burnerbyte/internal/crypto"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

var startTime = time.Now()

type AdminHandler struct {
	analyticsSvc       *service.AnalyticsService
	orgSvc             *service.OrgService
	authSvc            *service.AuthService
	sysConfig          *postgres.SystemConfigRepo
	ssoProviderRepo    *postgres.SSOProviderRepo
	domainMappingRepo  *postgres.SSODomainMappingRepo
	teamRepo           *postgres.TeamRepo
	ssoMgr             *auth.SSOManager
	encryptor          *appcrypto.Encryptor
	cfg                *config.Config
	pool               *pgxpool.Pool
	rdb                *redis.Client
	s3                 *minio.Client
	bucket             string
}

func NewAdminHandler(analyticsSvc *service.AnalyticsService, orgSvc *service.OrgService, authSvc *service.AuthService, sysConfig *postgres.SystemConfigRepo, ssoProviderRepo *postgres.SSOProviderRepo, domainMappingRepo *postgres.SSODomainMappingRepo, teamRepo *postgres.TeamRepo, ssoMgr *auth.SSOManager, encryptor *appcrypto.Encryptor, cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client, s3 *minio.Client, bucket string) *AdminHandler {
	return &AdminHandler{analyticsSvc: analyticsSvc, orgSvc: orgSvc, authSvc: authSvc, sysConfig: sysConfig, ssoProviderRepo: ssoProviderRepo, domainMappingRepo: domainMappingRepo, teamRepo: teamRepo, ssoMgr: ssoMgr, encryptor: encryptor, cfg: cfg, pool: pool, rdb: rdb, s3: s3, bucket: bucket}
}

func (h *AdminHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.analyticsSvc.GetSystemStats(r.Context())
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, stats)
}

func (h *AdminHandler) ListOrgs(w http.ResponseWriter, r *http.Request) {
	page, perPage := parsePagination(r)
	orgs, total, err := h.orgSvc.ListAll(r.Context(), page, perPage)
	if err != nil { writeError(w, http.StatusInternalServerError, "failed"); return }
	writeJSON(w, http.StatusOK, paginatedResponse(orgs, total, page, perPage))
}

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	page, perPage := parsePagination(r)
	users, total, err := h.authSvc.ListAllUsers(r.Context(), page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	writeJSON(w, http.StatusOK, paginatedResponse(users, total, page, perPage))
}

func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	// Prevent self-deletion
	if userID == uc.UserID {
		writeError(w, http.StatusBadRequest, "cannot delete your own account from admin panel")
		return
	}

	// Fetch target user before delete for audit
	targetUser, _ := h.authSvc.GetMe(r.Context(), userID)
	targetEmail := ""
	targetDisplayName := ""
	if targetUser != nil {
		targetEmail = targetUser.Email
		targetDisplayName = targetUser.DisplayName
	}

	if err := h.authSvc.DeleteUser(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}
	auditRecordEnhanced(r, uuid.Nil, "admin.user_deleted", "user", userID, targetEmail, map[string]any{"target_user_id": userID.String(), "email": targetEmail, "display_name": targetDisplayName})
	writeJSON(w, http.StatusOK, map[string]string{"message": "user deleted"})
}

func (h *AdminHandler) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	type svcHealth struct {
		Status  string `json:"status"`
		Latency string `json:"latency"`
	}

	services := map[string]svcHealth{}

	check := func(name string, fn func() error) {
		t0 := time.Now()
		if err := fn(); err != nil {
			services[name] = svcHealth{Status: "error: " + err.Error(), Latency: time.Since(t0).Round(time.Microsecond).String()}
		} else {
			services[name] = svcHealth{Status: "ok", Latency: time.Since(t0).Round(time.Microsecond).String()}
		}
	}

	check("postgres", func() error { return h.pool.Ping(ctx) })
	check("redis", func() error { return h.rdb.Ping(ctx).Err() })
	if h.s3 != nil {
		check("minio", func() error {
			_, err := h.s3.BucketExists(ctx, h.bucket)
			return err
		})
	}

	status := http.StatusOK
	for _, v := range services {
		if v.Status != "ok" {
			status = http.StatusServiceUnavailable
			break
		}
	}
	writeJSON(w, status, map[string]any{
		"services": services,
		"uptime":   time.Since(startTime).Round(time.Second).String(),
	})
}

func (h *AdminHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	var input struct {
		DisplayName    *string `json:"display_name,omitempty"`
		AvatarURL      *string `json:"avatar_url,omitempty"`
		IsSystemAdmin  *bool   `json:"is_system_admin,omitempty"`
		EmailVerified  *bool   `json:"email_verified,omitempty"`
		AuthMethodLock *string `json:"auth_method_lock,omitempty"`
		MaxSessions    *int    `json:"max_sessions,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Prevent removing your own admin status
	if input.IsSystemAdmin != nil && !*input.IsSystemAdmin && userID == uc.UserID {
		writeError(w, http.StatusBadRequest, "cannot remove your own system admin status")
		return
	}
	if input.DisplayName != nil {
		if err := auth.ValidateDisplayName(*input.DisplayName); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	// Validate max_sessions when provided
	if input.MaxSessions != nil && (*input.MaxSessions < 1 || *input.MaxSessions > 100) {
		writeError(w, http.StatusBadRequest, "max_sessions must be between 1 and 100")
		return
	}

	// Fetch user before update for diff
	beforeUser, _ := h.authSvc.GetMe(r.Context(), userID)

	user, err := h.authSvc.AdminUpdateUser(r.Context(), userID, input.DisplayName, input.AvatarURL, input.IsSystemAdmin, input.EmailVerified, input.MaxSessions)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	// Handle auth_method_lock if provided
	if input.AuthMethodLock != nil {
		lockUser, lockErr := h.authSvc.SetAuthMethodLock(r.Context(), userID, input.AuthMethodLock)
		if lockErr != nil {
			writeError(w, http.StatusBadRequest, lockErr.Error())
			return
		}
		user = lockUser
		auditRecordEnhanced(r, uuid.Nil, "admin.auth_method_lock_changed", "user", userID, user.Email, map[string]any{
			"auth_method_lock": *input.AuthMethodLock,
		})
	}

	meta := map[string]any{"email": user.Email, "display_name": input.DisplayName, "is_system_admin": input.IsSystemAdmin, "email_verified": input.EmailVerified, "auth_method_lock": input.AuthMethodLock, "max_sessions": input.MaxSessions}
	if beforeUser != nil {
		meta["before"] = map[string]any{"display_name": beforeUser.DisplayName, "avatar_url": beforeUser.AvatarURL, "is_system_admin": beforeUser.IsSystemAdmin, "email_verified": beforeUser.EmailVerified, "max_sessions": beforeUser.MaxSessions}
		meta["after"] = map[string]any{"display_name": user.DisplayName, "avatar_url": user.AvatarURL, "is_system_admin": user.IsSystemAdmin, "email_verified": user.EmailVerified, "max_sessions": user.MaxSessions}
	}
	auditRecordEnhanced(r, uuid.Nil, "admin.user_updated", "user", userID, user.Email, meta)
	writeJSON(w, http.StatusOK, user)
}

func (h *AdminHandler) MigrateAuth(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	var input struct {
		Target      string `json:"target"`
		NewPassword string `json:"new_password,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch target user before migration for audit
	beforeUser, _ := h.authSvc.GetMe(r.Context(), userID)
	targetEmail := ""
	if beforeUser != nil {
		targetEmail = beforeUser.Email
	}

	var user *domain.User
	switch input.Target {
	case "sso":
		user, err = h.authSvc.MigrateToSSO(r.Context(), userID)
	case "password":
		if input.NewPassword == "" {
			writeError(w, http.StatusBadRequest, "new_password is required when migrating to password")
			return
		}
		user, err = h.authSvc.MigrateToPassword(r.Context(), userID, input.NewPassword)
	default:
		writeError(w, http.StatusBadRequest, "target must be \"sso\" or \"password\"")
		return
	}

	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "admin.auth_migrated", "user", userID, targetEmail, map[string]any{
		"target": input.Target, "email": targetEmail,
	})
	writeJSON(w, http.StatusOK, user)
}

type PlatformSettings struct {
	AllowRegistration    bool   `json:"allow_registration"`
	EmailVerification    bool   `json:"email_verification"`
	PasswordMinLength    int    `json:"password_min_length"`
	PasswordRequireUpper bool   `json:"password_require_upper"`
	PasswordRequireLower bool   `json:"password_require_lower"`
	PasswordRequireNum   bool   `json:"password_require_number"`
	PasswordRequireSpec  bool   `json:"password_require_special"`
	LockoutMaxAttempts   int    `json:"lockout_max_attempts"`
	LockoutDurationMins  int    `json:"lockout_duration_mins"`
	Timezone             string `json:"timezone"`
	DateFormat           string `json:"date_format"`
	TimeFormat           string `json:"time_format"`
	DefaultInboxTTL      string `json:"default_inbox_ttl"`
	MaxInboxTTL          string `json:"max_inbox_ttl"`
	MaxAttachmentSizeMB  int    `json:"max_attachment_size_mb"`
	MaxDomains           int    `json:"max_domains"`
	MaxTeams             int    `json:"max_teams"`
	MaxInboxesPerDomain  int    `json:"max_inboxes_per_domain"`
	MaxSessionsPerUser   int    `json:"max_sessions_per_user"`
}

func (h *AdminHandler) GetPlatformSettings(w http.ResponseWriter, r *http.Request) {
	d := h.cfg.RuntimeDefaults()
	pw := h.cfg.PasswordPolicy()
	lk := h.cfg.LockoutPolicy()
	tz := d.Timezone
	df := d.DateFormat
	tf := d.TimeFormat
	ps := PlatformSettings{
		AllowRegistration:    d.AllowRegistration,
		EmailVerification:    h.cfg.EmailVerificationEnabled(),
		PasswordMinLength:    pw.MinLength,
		PasswordRequireUpper: pw.RequireUppercase,
		PasswordRequireLower: pw.RequireLowercase,
		PasswordRequireNum:   pw.RequireNumber,
		PasswordRequireSpec:  pw.RequireSpecial,
		LockoutMaxAttempts:   lk.MaxAttempts,
		LockoutDurationMins:  int(lk.Duration.Minutes()),
		DefaultInboxTTL:      d.DefaultInboxTTL.String(),
		MaxInboxTTL:          d.MaxInboxTTL.String(),
		MaxAttachmentSizeMB:  d.MaxAttachmentSizeMB,
		MaxDomains:           d.MaxDomains,
		MaxTeams:             d.MaxTeams,
		MaxInboxesPerDomain:  d.MaxInboxesPerDomain,
		MaxSessionsPerUser:   d.MaxSessionsPerUser,
	}
	if tz == "" { tz = "UTC" }
	if df == "" { df = "YYYY-MM-DD" }
	if tf == "" { tf = "24h" }
	if ps.DefaultInboxTTL == "0s" { ps.DefaultInboxTTL = "" }
	if ps.MaxInboxTTL == "0s" { ps.MaxInboxTTL = "" }
	ps.Timezone = tz
	ps.DateFormat = df
	ps.TimeFormat = tf
	writeJSON(w, http.StatusOK, ps)
}

func (h *AdminHandler) UpdatePlatformSettings(w http.ResponseWriter, r *http.Request) {
	var input PlatformSettings
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// ── Validate and clamp numeric settings ──
	if input.PasswordMinLength < 6 {
		input.PasswordMinLength = 6
	}
	if input.PasswordMinLength > 128 {
		writeError(w, http.StatusBadRequest, "password_min_length must not exceed 128")
		return
	}
	if input.LockoutMaxAttempts < 1 {
		input.LockoutMaxAttempts = 1
	}
	if input.LockoutMaxAttempts > 100 {
		writeError(w, http.StatusBadRequest, "lockout_max_attempts must not exceed 100")
		return
	}
	if input.LockoutDurationMins < 1 {
		input.LockoutDurationMins = 1
	}
	if input.LockoutDurationMins > 1440 {
		writeError(w, http.StatusBadRequest, "lockout_duration_mins must not exceed 1440 (24 hours)")
		return
	}
	if input.MaxSessionsPerUser < 1 || input.MaxSessionsPerUser > 100 {
		writeError(w, http.StatusBadRequest, "max_sessions_per_user must be between 1 and 100")
		return
	}
	if input.MaxAttachmentSizeMB < 0 || input.MaxAttachmentSizeMB > 100 {
		writeError(w, http.StatusBadRequest, "max_attachment_size_mb must be between 0 and 100")
		return
	}
	if input.MaxDomains < 0 || input.MaxDomains > 10000 {
		writeError(w, http.StatusBadRequest, "max_domains must be between 0 and 10000")
		return
	}
	if input.MaxTeams < 0 || input.MaxTeams > 10000 {
		writeError(w, http.StatusBadRequest, "max_teams must be between 0 and 10000")
		return
	}
	if input.MaxInboxesPerDomain < 0 || input.MaxInboxesPerDomain > 100000 {
		writeError(w, http.StatusBadRequest, "max_inboxes_per_domain must be between 0 and 100000")
		return
	}

	// Capture before state via synchronized snapshots
	pwBefore := h.cfg.PasswordPolicy()
	lkBefore := h.cfg.LockoutPolicy()
	dBefore := h.cfg.RuntimeDefaults()
	before := map[string]any{
		"allow_registration":    dBefore.AllowRegistration,
		"email_verification":    h.cfg.EmailVerificationEnabled(),
		"password_min_length":   pwBefore.MinLength,
		"password_require_upper": pwBefore.RequireUppercase,
		"password_require_lower": pwBefore.RequireLowercase,
		"password_require_number": pwBefore.RequireNumber,
		"password_require_special": pwBefore.RequireSpecial,
		"lockout_max_attempts":  lkBefore.MaxAttempts,
		"lockout_duration_mins": int(lkBefore.Duration.Minutes()),
		"max_sessions_per_user": dBefore.MaxSessionsPerUser,
	}

	// Validate duration fields before any mutation
	var parsedDefaultTTL time.Duration
	var hasDefaultTTL bool
	if input.DefaultInboxTTL != "" {
		d, err := time.ParseDuration(input.DefaultInboxTTL)
		if err != nil || d < 0 || d > 365*24*time.Hour {
			writeError(w, http.StatusBadRequest, "default_inbox_ttl must be between 0 and 365 days")
			return
		}
		parsedDefaultTTL = d
		hasDefaultTTL = true
	}
	var parsedMaxTTL time.Duration
	var hasMaxTTL bool
	if input.MaxInboxTTL != "" {
		d, err := time.ParseDuration(input.MaxInboxTTL)
		if err != nil || d < 0 || d > 365*24*time.Hour {
			writeError(w, http.StatusBadRequest, "max_inbox_ttl must be between 0 and 365 days")
			return
		}
		parsedMaxTTL = d
		hasMaxTTL = true
	}

	if err := h.sysConfig.Set(r.Context(), "platform", input); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	// Apply to running config under the shared config lock, so the services
	// that read these fields never observe a torn update.
	h.cfg.WriteLocked(func(c *config.Config) {
		c.Defaults.AllowRegistration = input.AllowRegistration
		c.EmailVerification.Enabled = input.EmailVerification
		c.Password.MinLength = input.PasswordMinLength
		c.Password.RequireUppercase = input.PasswordRequireUpper
		c.Password.RequireLowercase = input.PasswordRequireLower
		c.Password.RequireNumber = input.PasswordRequireNum
		c.Password.RequireSpecial = input.PasswordRequireSpec
		c.Lockout.MaxAttempts = input.LockoutMaxAttempts
		c.Lockout.Duration = time.Duration(input.LockoutDurationMins) * time.Minute
		c.Defaults.Timezone = input.Timezone
		c.Defaults.DateFormat = input.DateFormat
		c.Defaults.TimeFormat = input.TimeFormat
		if hasDefaultTTL {
			c.Defaults.DefaultInboxTTL = parsedDefaultTTL
		}
		if hasMaxTTL {
			c.Defaults.MaxInboxTTL = parsedMaxTTL
		}
		c.Defaults.MaxAttachmentSizeMB = input.MaxAttachmentSizeMB
		c.Defaults.MaxDomains = input.MaxDomains
		c.Defaults.MaxTeams = input.MaxTeams
		c.Defaults.MaxInboxesPerDomain = input.MaxInboxesPerDomain
		c.Defaults.MaxSessionsPerUser = input.MaxSessionsPerUser
	})

	after := map[string]any{
		"allow_registration":    input.AllowRegistration,
		"email_verification":    input.EmailVerification,
		"password_min_length":   input.PasswordMinLength,
		"password_require_upper": input.PasswordRequireUpper,
		"password_require_lower": input.PasswordRequireLower,
		"password_require_number": input.PasswordRequireNum,
		"password_require_special": input.PasswordRequireSpec,
		"lockout_max_attempts":  input.LockoutMaxAttempts,
		"lockout_duration_mins": input.LockoutDurationMins,
		"max_sessions_per_user": input.MaxSessionsPerUser,
	}

	auditRecordEnhanced(r, uuid.Nil, "admin.platform_settings_updated", "platform", uuid.Nil, "platform", map[string]any{
		"allow_registration":    input.AllowRegistration,
		"email_verification":    input.EmailVerification,
		"password_min_length":   input.PasswordMinLength,
		"lockout_max_attempts":  input.LockoutMaxAttempts,
		"lockout_duration_mins": input.LockoutDurationMins,
		"before":                before,
		"after":                 after,
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "platform settings updated"})
}

// ── SSO Provider CRUD ──

func (h *AdminHandler) ListSSOProviders(w http.ResponseWriter, r *http.Request) {
	if h.ssoProviderRepo == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	providers, err := h.ssoProviderRepo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list SSO providers")
		return
	}
	// Mask client secrets
	for i := range providers {
		providers[i].ClientSecret = "••••••••"
		providers[i].ClientSecretEncrypted = ""
	}
	if providers == nil {
		providers = []domain.SSOProvider{}
	}
	writeJSON(w, http.StatusOK, providers)
}

func (h *AdminHandler) CreateSSOProvider(w http.ResponseWriter, r *http.Request) {
	if h.ssoProviderRepo == nil {
		writeError(w, http.StatusInternalServerError, "SSO provider repository not configured")
		return
	}
	var input domain.SSOProvider
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" || input.ProviderType == "" || input.ClientID == "" || input.ClientSecret == "" {
		writeError(w, http.StatusBadRequest, "name, provider_type, client_id, and client_secret are required")
		return
	}
	if input.RedirectURL == "" {
		writeError(w, http.StatusBadRequest, "redirect_url is required")
		return
	}
	if !strings.HasPrefix(input.RedirectURL, "https://") && !strings.HasPrefix(input.RedirectURL, "http://localhost") {
		writeError(w, http.StatusBadRequest, "redirect_url must use HTTPS (except localhost for development)")
		return
	}
	validTypes := map[string]bool{"google": true, "github": true, "azure": true, "okta": true, "oidc": true}
	if !validTypes[input.ProviderType] {
		writeError(w, http.StatusBadRequest, "provider_type must be one of: google, github, azure, okta, oidc")
		return
	}
	if (input.ProviderType == "okta" || input.ProviderType == "oidc") && input.IssuerURL == "" {
		writeError(w, http.StatusBadRequest, "issuer_url is required for okta and oidc provider types")
		return
	}
	if (input.ProviderType == "okta" || input.ProviderType == "oidc") && input.IssuerURL != "" {
		if !strings.HasPrefix(input.IssuerURL, "https://") {
			writeError(w, http.StatusBadRequest, "issuer_url must use HTTPS")
			return
		}
	}
	if input.ProviderType == "azure" && input.TenantID == "" {
		writeError(w, http.StatusBadRequest, "tenant_id is required for azure provider type")
		return
	}

	input.ID = uuid.New()
	if input.DefaultOrgRole == "" {
		input.DefaultOrgRole = "member"
	}
	if input.DefaultTeamRole == "" {
		input.DefaultTeamRole = "member"
	}

	if err := h.ssoProviderRepo.Create(r.Context(), &input); err != nil {
		if err.Error() == "conflict: resource already exists" {
			writeError(w, http.StatusConflict, "a provider with this name already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create SSO provider")
		return
	}

	// Reload SSO Manager providers
	h.reloadSSOProviders(r.Context())

	auditRecordEnhanced(r, uuid.Nil, "admin.sso_provider_created", "sso_provider", input.ID, input.Name, map[string]any{
		"name": input.Name, "provider_type": input.ProviderType,
	})

	input.ClientSecret = "••••••••"
	input.ClientSecretEncrypted = ""
	writeJSON(w, http.StatusCreated, input)
}

func (h *AdminHandler) GetSSOProvider(w http.ResponseWriter, r *http.Request) {
	if h.ssoProviderRepo == nil {
		writeError(w, http.StatusNotFound, "SSO provider repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}
	provider, err := h.ssoProviderRepo.GetByID(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusNotFound, "SSO provider not found")
		return
	}
	provider.ClientSecret = "••••••••"
	provider.ClientSecretEncrypted = ""
	writeJSON(w, http.StatusOK, provider)
}

func (h *AdminHandler) UpdateSSOProvider(w http.ResponseWriter, r *http.Request) {
	if h.ssoProviderRepo == nil {
		writeError(w, http.StatusInternalServerError, "SSO provider repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}

	existing, err := h.ssoProviderRepo.GetByID(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusNotFound, "SSO provider not found")
		return
	}

	var input domain.SSOProvider
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	input.ID = providerID
	// If client_secret is masked, keep existing encrypted value
	if input.ClientSecret == "••••••••" || input.ClientSecret == "" {
		input.ClientSecret = ""
		input.ClientSecretEncrypted = existing.ClientSecretEncrypted
	}

	if err := h.ssoProviderRepo.Update(r.Context(), &input); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update SSO provider")
		return
	}

	// Reload SSO Manager providers
	h.reloadSSOProviders(r.Context())

	auditRecordEnhanced(r, uuid.Nil, "admin.sso_config_updated", "sso_provider", providerID, input.Name, map[string]any{
		"name": input.Name, "provider_type": input.ProviderType,
	})

	input.ClientSecret = "••••••••"
	input.ClientSecretEncrypted = ""
	writeJSON(w, http.StatusOK, input)
}

func (h *AdminHandler) DeleteSSOProvider(w http.ResponseWriter, r *http.Request) {
	if h.ssoProviderRepo == nil {
		writeError(w, http.StatusInternalServerError, "SSO provider repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}

	provider, err := h.ssoProviderRepo.GetByID(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusNotFound, "SSO provider not found")
		return
	}

	linkedCount, _ := h.ssoProviderRepo.CountLinkedUsers(r.Context(), provider.Name)

	if err := h.ssoProviderRepo.Delete(r.Context(), providerID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete SSO provider")
		return
	}

	// Reload SSO Manager providers
	h.reloadSSOProviders(r.Context())

	auditRecordEnhanced(r, uuid.Nil, "admin.sso_provider_deleted", "sso_provider", providerID, provider.Name, map[string]any{
		"name": provider.Name, "linked_user_count": linkedCount,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"message":           "SSO provider deleted",
		"linked_user_count": linkedCount,
	})
}

func (h *AdminHandler) TestSSOConnection(w http.ResponseWriter, r *http.Request) {
	if h.ssoMgr == nil {
		writeError(w, http.StatusInternalServerError, "SSO manager not configured")
		return
	}
	var input domain.SSOProvider
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.ssoMgr.TestConnection(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "test connection failed")
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "admin.sso_test", "sso_provider", uuid.Nil, input.Name, map[string]any{
		"provider": input.Name, "success": result.Success, "endpoint": result.Endpoint,
	})

	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) reloadSSOProviders(ctx context.Context) {
	if h.ssoProviderRepo == nil || h.ssoMgr == nil {
		return
	}
	providers, err := h.ssoProviderRepo.ListEnabled(ctx)
	if err != nil {
		slog.Error("failed to reload SSO providers", "error", err)
		return
	}
	h.ssoMgr.LoadProviders(ctx, providers)
}

// ── SSO Domain Mapping CRUD ──

func (h *AdminHandler) ListDomainMappings(w http.ResponseWriter, r *http.Request) {
	if h.domainMappingRepo == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}
	mappings, err := h.domainMappingRepo.ListByProvider(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list domain mappings")
		return
	}
	if mappings == nil {
		mappings = []domain.SSODomainMapping{}
	}
	writeJSON(w, http.StatusOK, mappings)
}

func (h *AdminHandler) CreateDomainMapping(w http.ResponseWriter, r *http.Request) {
	if h.domainMappingRepo == nil {
		writeError(w, http.StatusInternalServerError, "domain mapping repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}
	var input domain.SSODomainMapping
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Validate domain format
	input.Domain = strings.TrimSpace(strings.ToLower(input.Domain))
	if input.Domain == "" || !isValidDomainFormat(input.Domain) {
		writeError(w, http.StatusBadRequest, "invalid domain format")
		return
	}
	// Validate team exists and is not archived
	if h.teamRepo == nil {
		writeError(w, http.StatusInternalServerError, "team repository not configured")
		return
	}
	team, err := h.teamRepo.GetByID(r.Context(), input.TeamID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "team not found")
		return
	}
	if team.IsArchived {
		writeError(w, http.StatusBadRequest, "cannot map to an archived team")
		return
	}
	// Validate roles
	if input.OrgRole == "" {
		input.OrgRole = "member"
	}
	if input.TeamRole == "" {
		input.TeamRole = "member"
	}

	input.ID = uuid.New()
	input.ProviderID = providerID

	if err := h.domainMappingRepo.Create(r.Context(), &input); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			writeError(w, http.StatusConflict, "a domain mapping with this provider, domain, and team already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create domain mapping")
		return
	}

	// Enrich with team name
	input.TeamName = team.Name

	auditRecordEnhanced(r, uuid.Nil, "admin.domain_mapping_created", "sso_domain_mapping", input.ID, input.Domain, map[string]any{
		"provider_id": providerID.String(), "domain": input.Domain, "team_id": input.TeamID.String(),
		"team_name": team.Name, "org_role": input.OrgRole, "team_role": input.TeamRole,
	})
	writeJSON(w, http.StatusCreated, input)
}

func (h *AdminHandler) UpdateDomainMapping(w http.ResponseWriter, r *http.Request) {
	if h.domainMappingRepo == nil {
		writeError(w, http.StatusInternalServerError, "domain mapping repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}
	mappingID, err := uuid.Parse(chi.URLParam(r, "mappingId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid mapping ID")
		return
	}

	existing, err := h.domainMappingRepo.GetByID(r.Context(), mappingID)
	if err != nil {
		writeError(w, http.StatusNotFound, "domain mapping not found")
		return
	}
	if existing.ProviderID != providerID {
		writeError(w, http.StatusNotFound, "domain mapping not found for this provider")
		return
	}

	var input domain.SSODomainMapping
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Validate domain format
	input.Domain = strings.TrimSpace(strings.ToLower(input.Domain))
	if input.Domain == "" || !isValidDomainFormat(input.Domain) {
		writeError(w, http.StatusBadRequest, "invalid domain format")
		return
	}
	// Validate team exists and is not archived
	if h.teamRepo == nil {
		writeError(w, http.StatusInternalServerError, "team repository not configured")
		return
	}
	team, err := h.teamRepo.GetByID(r.Context(), input.TeamID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "team not found")
		return
	}
	if team.IsArchived {
		writeError(w, http.StatusBadRequest, "cannot map to an archived team")
		return
	}
	// Validate roles
	if input.OrgRole == "" {
		input.OrgRole = "member"
	}
	if input.TeamRole == "" {
		input.TeamRole = "member"
	}

	input.ID = mappingID
	input.ProviderID = providerID

	if err := h.domainMappingRepo.Update(r.Context(), &input); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			writeError(w, http.StatusConflict, "a domain mapping with this provider, domain, and team already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update domain mapping")
		return
	}

	input.TeamName = team.Name

	auditRecordEnhanced(r, uuid.Nil, "admin.domain_mapping_updated", "sso_domain_mapping", mappingID, input.Domain, map[string]any{
		"provider_id": providerID.String(), "domain": input.Domain, "team_id": input.TeamID.String(),
		"team_name": team.Name, "org_role": input.OrgRole, "team_role": input.TeamRole,
		"before": map[string]any{"domain": existing.Domain, "team_id": existing.TeamID.String(), "org_role": existing.OrgRole, "team_role": existing.TeamRole},
	})
	writeJSON(w, http.StatusOK, input)
}

func (h *AdminHandler) DeleteDomainMapping(w http.ResponseWriter, r *http.Request) {
	if h.domainMappingRepo == nil {
		writeError(w, http.StatusInternalServerError, "domain mapping repository not configured")
		return
	}
	providerID, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid provider ID")
		return
	}
	mappingID, err := uuid.Parse(chi.URLParam(r, "mappingId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid mapping ID")
		return
	}

	existing, err := h.domainMappingRepo.GetByID(r.Context(), mappingID)
	if err != nil {
		writeError(w, http.StatusNotFound, "domain mapping not found")
		return
	}
	if existing.ProviderID != providerID {
		writeError(w, http.StatusNotFound, "domain mapping not found for this provider")
		return
	}

	if err := h.domainMappingRepo.Delete(r.Context(), mappingID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete domain mapping")
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "admin.domain_mapping_deleted", "sso_domain_mapping", mappingID, existing.Domain, map[string]any{
		"provider_id": providerID.String(), "domain": existing.Domain, "team_id": existing.TeamID.String(),
		"team_name": existing.TeamName, "org_role": existing.OrgRole, "team_role": existing.TeamRole,
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "domain mapping deleted"})
}

// ── Domain Mapping Preview/Dry-Run ──

func (h *AdminHandler) PreviewDomainMapping(w http.ResponseWriter, r *http.Request) {
	if h.domainMappingRepo == nil {
		writeError(w, http.StatusInternalServerError, "domain mapping repository not configured")
		return
	}
	var input domain.DomainMappingPreviewInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Validate email format
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	if input.Email == "" || !strings.Contains(input.Email, "@") {
		writeError(w, http.StatusBadRequest, "invalid email format")
		return
	}
	parts := strings.SplitN(input.Email, "@", 2)
	if len(parts) != 2 || parts[1] == "" {
		writeError(w, http.StatusBadRequest, "invalid email format")
		return
	}
	emailDomain := parts[1]

	// Look up SSO provider by name
	if h.ssoProviderRepo == nil {
		writeError(w, http.StatusInternalServerError, "SSO provider repository not configured")
		return
	}
	provider, err := h.ssoProviderRepo.GetByName(r.Context(), input.Provider)
	if err != nil {
		writeError(w, http.StatusNotFound, "SSO provider not found")
		return
	}

	// Find matching rules (read-only)
	matchingRules, err := h.domainMappingRepo.FindMatchingRules(r.Context(), provider.ID, emailDomain)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to find matching rules")
		return
	}
	if matchingRules == nil {
		matchingRules = []domain.SSODomainMapping{}
	}

	// Build preview result
	result := domain.DomainMappingPreviewResult{
		Email:             input.Email,
		EmailDomain:       emailDomain,
		Provider:          input.Provider,
		MatchingRules:     matchingRules,
		WouldBypassInvite: len(matchingRules) > 0,
		TeamAssignments:   []domain.DomainMappingPreviewTeam{},
	}

	if len(matchingRules) > 0 {
		result.OrgRole = matchingRules[0].OrgRole
		for _, rule := range matchingRules {
			result.TeamAssignments = append(result.TeamAssignments, domain.DomainMappingPreviewTeam{
				TeamID:   rule.TeamID,
				TeamName: rule.TeamName,
				TeamRole: rule.TeamRole,
			})
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// isValidDomainFormat validates a domain string (e.g., "example.com").
func isValidDomainFormat(d string) bool {
	if len(d) > 255 || len(d) < 3 {
		return false
	}
	// Must contain at least one dot
	if !strings.Contains(d, ".") {
		return false
	}
	// Must not start or end with a dot or hyphen
	if d[0] == '.' || d[0] == '-' || d[len(d)-1] == '.' || d[len(d)-1] == '-' {
		return false
	}
	// Each label must be valid
	labels := strings.Split(d, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 {
			return false
		}
		for _, c := range label {
			if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
				return false
			}
		}
	}
	// TLD must be at least 2 characters
	if len(labels[len(labels)-1]) < 2 {
		return false
	}
	return true
}
