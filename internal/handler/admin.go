package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

var startTime = time.Now()

type AdminHandler struct {
	analyticsSvc *service.AnalyticsService
	orgSvc       *service.OrgService
	authSvc      *service.AuthService
	sysConfig    *postgres.SystemConfigRepo
	cfg          *config.Config
	cfgMu        sync.RWMutex
	pool         *pgxpool.Pool
	rdb          *redis.Client
	s3           *minio.Client
	bucket       string
}

func NewAdminHandler(analyticsSvc *service.AnalyticsService, orgSvc *service.OrgService, authSvc *service.AuthService, sysConfig *postgres.SystemConfigRepo, cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client, s3 *minio.Client, bucket string) *AdminHandler {
	return &AdminHandler{analyticsSvc: analyticsSvc, orgSvc: orgSvc, authSvc: authSvc, sysConfig: sysConfig, cfg: cfg, pool: pool, rdb: rdb, s3: s3, bucket: bucket}
}

func (h *AdminHandler) Routes(r chi.Router) {
		r.Use(auth.RequireSystemAdmin)
		r.Get("/admin/stats", h.Stats)
		r.Get("/admin/orgs", h.ListOrgs)
		r.Get("/admin/users", h.ListUsers)
		r.Delete("/admin/users/{userId}", h.DeleteUser)
		r.Patch("/admin/users/{userId}", h.UpdateUser)
		r.Get("/admin/health", h.Health)
		r.Get("/admin/platform", h.GetPlatformSettings)
		r.Put("/admin/platform", h.UpdatePlatformSettings)
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
		DisplayName   *string `json:"display_name,omitempty"`
		AvatarURL     *string `json:"avatar_url,omitempty"`
		IsSystemAdmin *bool   `json:"is_system_admin,omitempty"`
		EmailVerified *bool   `json:"email_verified,omitempty"`
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

	// Fetch user before update for diff
	beforeUser, _ := h.authSvc.GetMe(r.Context(), userID)

	user, err := h.authSvc.AdminUpdateUser(r.Context(), userID, input.DisplayName, input.AvatarURL, input.IsSystemAdmin, input.EmailVerified)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	meta := map[string]any{"email": user.Email, "display_name": input.DisplayName, "is_system_admin": input.IsSystemAdmin, "email_verified": input.EmailVerified}
	if beforeUser != nil {
		meta["before"] = map[string]any{"display_name": beforeUser.DisplayName, "avatar_url": beforeUser.AvatarURL, "is_system_admin": beforeUser.IsSystemAdmin, "email_verified": beforeUser.EmailVerified}
		meta["after"] = map[string]any{"display_name": user.DisplayName, "avatar_url": user.AvatarURL, "is_system_admin": user.IsSystemAdmin, "email_verified": user.EmailVerified}
	}
	auditRecordEnhanced(r, uuid.Nil, "admin.user_updated", "user", userID, user.Email, meta)
	writeJSON(w, http.StatusOK, user)
}

func (h *AdminHandler) GetSSOConfig(w http.ResponseWriter, r *http.Request) {
	h.cfgMu.RLock()
	masked := h.cfg.SSO
	h.cfgMu.RUnlock()
	if masked.ClientSecret != "" {
		masked.ClientSecret = "••••••••"
	}
	writeJSON(w, http.StatusOK, masked)
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
}

func (h *AdminHandler) GetPlatformSettings(w http.ResponseWriter, r *http.Request) {
	h.cfgMu.RLock()
	tz := h.cfg.Defaults.Timezone
	df := h.cfg.Defaults.DateFormat
	tf := h.cfg.Defaults.TimeFormat
	ps := PlatformSettings{
		AllowRegistration:    h.cfg.Defaults.AllowRegistration,
		EmailVerification:    h.cfg.EmailVerification.Enabled,
		PasswordMinLength:    h.cfg.Password.MinLength,
		PasswordRequireUpper: h.cfg.Password.RequireUppercase,
		PasswordRequireLower: h.cfg.Password.RequireLowercase,
		PasswordRequireNum:   h.cfg.Password.RequireNumber,
		PasswordRequireSpec:  h.cfg.Password.RequireSpecial,
		LockoutMaxAttempts:   h.cfg.Lockout.MaxAttempts,
		LockoutDurationMins:  int(h.cfg.Lockout.Duration.Minutes()),
		DefaultInboxTTL:      h.cfg.Defaults.DefaultInboxTTL.String(),
		MaxInboxTTL:          h.cfg.Defaults.MaxInboxTTL.String(),
		MaxAttachmentSizeMB:  h.cfg.Defaults.MaxAttachmentSizeMB,
		MaxDomains:           h.cfg.Defaults.MaxDomains,
		MaxTeams:             h.cfg.Defaults.MaxTeams,
		MaxInboxesPerDomain:  h.cfg.Defaults.MaxInboxesPerDomain,
	}
	h.cfgMu.RUnlock()
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
	if input.PasswordMinLength < 6 {
		input.PasswordMinLength = 6
	}
	if input.LockoutMaxAttempts < 1 {
		input.LockoutMaxAttempts = 1
	}
	if input.LockoutDurationMins < 1 {
		input.LockoutDurationMins = 1
	}

	// Capture before state under read lock
	h.cfgMu.RLock()
	before := map[string]any{
		"allow_registration":    h.cfg.Defaults.AllowRegistration,
		"email_verification":    h.cfg.EmailVerification.Enabled,
		"password_min_length":   h.cfg.Password.MinLength,
		"password_require_upper": h.cfg.Password.RequireUppercase,
		"password_require_lower": h.cfg.Password.RequireLowercase,
		"password_require_number": h.cfg.Password.RequireNumber,
		"password_require_special": h.cfg.Password.RequireSpecial,
		"lockout_max_attempts":  h.cfg.Lockout.MaxAttempts,
		"lockout_duration_mins": int(h.cfg.Lockout.Duration.Minutes()),
	}
	h.cfgMu.RUnlock()

	if err := h.sysConfig.Set(r.Context(), "platform", input); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	// Apply to running config under lock
	h.cfgMu.Lock()
	h.cfg.Defaults.AllowRegistration = input.AllowRegistration
	h.cfg.EmailVerification.Enabled = input.EmailVerification
	h.cfg.Password.MinLength = input.PasswordMinLength
	h.cfg.Password.RequireUppercase = input.PasswordRequireUpper
	h.cfg.Password.RequireLowercase = input.PasswordRequireLower
	h.cfg.Password.RequireNumber = input.PasswordRequireNum
	h.cfg.Password.RequireSpecial = input.PasswordRequireSpec
	h.cfg.Lockout.MaxAttempts = input.LockoutMaxAttempts
	h.cfg.Lockout.Duration = time.Duration(input.LockoutDurationMins) * time.Minute
	h.cfg.Defaults.Timezone = input.Timezone
	h.cfg.Defaults.DateFormat = input.DateFormat
	h.cfg.Defaults.TimeFormat = input.TimeFormat
	if d, err := time.ParseDuration(input.DefaultInboxTTL); err == nil {
		h.cfg.Defaults.DefaultInboxTTL = d
	}
	if d, err := time.ParseDuration(input.MaxInboxTTL); err == nil {
		h.cfg.Defaults.MaxInboxTTL = d
	}
	h.cfg.Defaults.MaxAttachmentSizeMB = input.MaxAttachmentSizeMB
	h.cfg.Defaults.MaxDomains = input.MaxDomains
	h.cfg.Defaults.MaxTeams = input.MaxTeams
	h.cfg.Defaults.MaxInboxesPerDomain = input.MaxInboxesPerDomain
	h.cfgMu.Unlock()

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

func (h *AdminHandler) UpdateSSOConfig(w http.ResponseWriter, r *http.Request) {
	var input config.SSOConfig
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Capture before state (excluding client_secret)
	h.cfgMu.RLock()
	before := map[string]any{
		"provider":         h.cfg.SSO.Provider,
		"client_id":        h.cfg.SSO.ClientID,
		"issuer_url":       h.cfg.SSO.IssuerURL,
		"allowed_domains":  h.cfg.SSO.AllowedDomains,
		"auto_provision":   h.cfg.SSO.AutoProvision,
		"default_org_role": h.cfg.SSO.DefaultOrgRole,
	}
	h.cfgMu.RUnlock()

	h.cfgMu.Lock()
	// If secret is masked, keep the existing one
	if input.ClientSecret == "••••••••" {
		input.ClientSecret = h.cfg.SSO.ClientSecret
	}
	h.cfgMu.Unlock()
	// Validate default org role if set
	if input.DefaultOrgRole != "" && !rbac.ValidOrgRole(input.DefaultOrgRole) {
		writeError(w, http.StatusBadRequest, "invalid default_org_role")
		return
	}
	// Cap auto-provision role to member or admin (never owner)
	if input.DefaultOrgRole == rbac.OrgOwner {
		writeError(w, http.StatusBadRequest, "default_org_role cannot be owner")
		return
	}
	if err := h.sysConfig.Set(r.Context(), "sso", input); err != nil {
		slog.Error("failed to save SSO config", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save SSO config")
		return
	}
	h.cfgMu.Lock()
	h.cfg.SSO = input
	h.cfgMu.Unlock()

	after := map[string]any{
		"provider":         input.Provider,
		"client_id":        input.ClientID,
		"issuer_url":       input.IssuerURL,
		"allowed_domains":  input.AllowedDomains,
		"auto_provision":   input.AutoProvision,
		"default_org_role": input.DefaultOrgRole,
	}

	auditRecordEnhanced(r, uuid.Nil, "admin.sso_config_updated", "sso", uuid.Nil, "sso", map[string]any{"provider": input.Provider, "before": before, "after": after})
	writeJSON(w, http.StatusOK, map[string]string{"message": "SSO config updated"})
}
