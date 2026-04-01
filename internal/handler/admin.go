package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
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
	if err := h.authSvc.DeleteUser(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}
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
	user, err := h.authSvc.AdminUpdateUser(r.Context(), userID, input.DisplayName, input.AvatarURL, input.IsSystemAdmin, input.EmailVerified)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *AdminHandler) GetSSOConfig(w http.ResponseWriter, r *http.Request) {
	// Return current SSO config (mask secret)
	masked := h.cfg.SSO
	if masked.ClientSecret != "" {
		masked.ClientSecret = "••••••••"
	}
	writeJSON(w, http.StatusOK, masked)
}

type PlatformSettings struct {
	AllowRegistration    bool `json:"allow_registration"`
	EmailVerification    bool `json:"email_verification"`
	PasswordMinLength    int  `json:"password_min_length"`
	PasswordRequireUpper bool `json:"password_require_upper"`
	PasswordRequireLower bool `json:"password_require_lower"`
	PasswordRequireNum   bool `json:"password_require_number"`
	PasswordRequireSpec  bool `json:"password_require_special"`
	LockoutMaxAttempts   int  `json:"lockout_max_attempts"`
	LockoutDurationMins  int  `json:"lockout_duration_mins"`
}

func (h *AdminHandler) GetPlatformSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, PlatformSettings{
		AllowRegistration:    h.cfg.Defaults.AllowRegistration,
		EmailVerification:    h.cfg.EmailVerification.Enabled,
		PasswordMinLength:    h.cfg.Password.MinLength,
		PasswordRequireUpper: h.cfg.Password.RequireUppercase,
		PasswordRequireLower: h.cfg.Password.RequireLowercase,
		PasswordRequireNum:   h.cfg.Password.RequireNumber,
		PasswordRequireSpec:  h.cfg.Password.RequireSpecial,
		LockoutMaxAttempts:   h.cfg.Lockout.MaxAttempts,
		LockoutDurationMins:  int(h.cfg.Lockout.Duration.Minutes()),
	})
}

func (h *AdminHandler) UpdatePlatformSettings(w http.ResponseWriter, r *http.Request) {
	var input PlatformSettings
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.sysConfig.Set(r.Context(), "platform", input); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	// Apply to running config
	h.cfg.Defaults.AllowRegistration = input.AllowRegistration
	h.cfg.EmailVerification.Enabled = input.EmailVerification
	h.cfg.Password.MinLength = input.PasswordMinLength
	h.cfg.Password.RequireUppercase = input.PasswordRequireUpper
	h.cfg.Password.RequireLowercase = input.PasswordRequireLower
	h.cfg.Password.RequireNumber = input.PasswordRequireNum
	h.cfg.Password.RequireSpecial = input.PasswordRequireSpec
	h.cfg.Lockout.MaxAttempts = input.LockoutMaxAttempts
	h.cfg.Lockout.Duration = time.Duration(input.LockoutDurationMins) * time.Minute
	writeJSON(w, http.StatusOK, map[string]string{"message": "platform settings updated"})
}

func (h *AdminHandler) UpdateSSOConfig(w http.ResponseWriter, r *http.Request) {
	var input config.SSOConfig
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// If secret is masked, keep the existing one
	if input.ClientSecret == "••••••••" {
		input.ClientSecret = h.cfg.SSO.ClientSecret
	}
	if err := h.sysConfig.Set(r.Context(), "sso", input); err != nil {
		slog.Error("failed to save SSO config", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save SSO config")
		return
	}
	h.cfg.SSO = input
	writeJSON(w, http.StatusOK, map[string]string{"message": "SSO config updated"})
}
