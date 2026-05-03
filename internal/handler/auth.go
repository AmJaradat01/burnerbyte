package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/middleware"
	"gitlab.com/burnerbyte/burnerbyte/internal/service"
)

type AuthHandler struct {
	svc *service.AuthService
	sso *auth.SSOManager
	cfg *config.Config
}

func NewAuthHandler(svc *service.AuthService, sso *auth.SSOManager, cfg *config.Config) *AuthHandler {
	return &AuthHandler{svc: svc, sso: sso, cfg: cfg}
}

func (h *AuthHandler) PublicRoutes(r chi.Router, rl *middleware.RateLimiter) {
	r.With(rl.LoginLimiter).Post("/auth/register", h.Register)
	r.With(rl.LoginLimiter).Post("/auth/login", h.Login)
	r.With(rl.LoginLimiter).Post("/auth/login/resolve", h.ResolveLogin)
	r.With(rl.LoginLimiter).Get("/auth/login/pending-sessions", h.GetPendingSessions)
	r.With(rl.LoginLimiter).Post("/auth/refresh", h.Refresh)
	r.With(rl.ForgotPasswordLimiter).Post("/auth/forgot-password", h.ForgotPassword)
	r.With(rl.LoginLimiter).Post("/auth/reset-password", h.ResetPassword)
	r.Get("/auth/verify-email/{token}", h.VerifyEmail)
	r.Get("/auth/sso/{provider}", h.SSORedirect)
	r.With(rl.LoginLimiter).Get("/auth/sso/{provider}/callback", h.SSOCallback)
	r.Get("/auth/sso-status", h.SSOStatus)
}

func (h *AuthHandler) AuthenticatedRoutes(r chi.Router) {
	r.Get("/auth/me", h.GetMe)
	r.Patch("/auth/me", h.UpdateProfile)
	r.Put("/auth/me/password", h.ChangePassword)
	r.Delete("/auth/me", h.DeleteAccount)
	r.Get("/auth/sessions", h.ListSessions)
	r.Delete("/auth/sessions/{sessionId}", h.RevokeSession)
	r.Delete("/auth/sessions", h.RevokeAllSessions)
	r.Get("/auth/datetime-settings", h.GetDateTimeSettings)
	r.Get("/auth/me/sso", h.ListSSOIdentities)
	r.Delete("/auth/me/sso/{provider}", h.UnlinkSSO)
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.Defaults.AllowRegistration {
		writeError(w, http.StatusForbidden, "public registration is disabled")
		return
	}

	var input domain.CreateUserInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Email == "" || input.Password == "" || input.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "email, password, and display_name are required")
		return
	}

	user, tokens, err := h.svc.Register(r.Context(), input)
	if err != nil {
		if err.Error() == "email already registered" {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.registered", "user", user.ID, user.Email, map[string]any{"email": user.Email, "display_name": user.DisplayName, "ip_address": r.RemoteAddr})
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":   user,
		"tokens": tokens,
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var input domain.LoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Email == "" || input.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	user, tokens, err := h.svc.Login(r.Context(), input, r.RemoteAddr, r.UserAgent())
	if err != nil {
		var lockedErr *service.LockedError
		if errors.As(err, &lockedErr) {
			auditRecordEnhanced(r, uuid.Nil, "user.locked", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "lockout_duration": lockedErr.RetryAfter.String()})
			auditRecordEnhanced(r, uuid.Nil, "user.login_failed", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "reason": "account_locked"})
			w.Header().Set("Retry-After", strconv.Itoa(int(lockedErr.RetryAfter.Seconds())))
			writeError(w, http.StatusLocked, err.Error())
			return
		}
		var limitErr *service.SessionLimitError
		if errors.As(err, &limitErr) {
			auditRecordEnhanced(r, uuid.Nil, "user.login_session_conflict", "user", uuid.Nil, input.Email, map[string]any{
				"email":           input.Email,
				"active_sessions": len(limitErr.Sessions),
				"limit":           limitErr.Limit,
			})
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":         "session limit reached",
				"code":          "session_limit",
				"pending_token": limitErr.PendingToken,
				"sessions":      limitErr.Sessions,
				"limit":         limitErr.Limit,
			})
			return
		}
		reason := "invalid_credentials"
		if strings.Contains(err.Error(), "SSO login required") {
			reason = "sso_enforced"
		}
		auditRecordEnhanced(r, uuid.Nil, "user.login_failed", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "reason": reason})
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.login", "user", user.ID, user.Email, map[string]any{"email": user.Email, "user_agent": r.Header.Get("User-Agent"), "ip_address": r.RemoteAddr, "login_method": "password"})
	writeJSON(w, http.StatusOK, map[string]any{
		"user":   user,
		"tokens": tokens,
	})
}

func (h *AuthHandler) ResolveLogin(w http.ResponseWriter, r *http.Request) {
	var input domain.ResolveLoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.PendingToken == "" || input.RevokeSessionID == uuid.Nil {
		writeError(w, http.StatusBadRequest, "pending_token and revoke_session_id are required")
		return
	}

	user, tokens, err := h.svc.ResolveLogin(r.Context(), input, r.RemoteAddr, r.UserAgent())
	if err != nil {
		var limitErr *service.SessionLimitError
		if errors.As(err, &limitErr) {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":         "session limit reached",
				"code":          "session_limit",
				"pending_token": limitErr.PendingToken,
				"sessions":      limitErr.Sessions,
				"limit":         limitErr.Limit,
			})
			return
		}
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.login", "user", user.ID, user.Email, map[string]any{
		"email":             user.Email,
		"login_method":      "password",
		"resolved_conflict": true,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"user":   user,
		"tokens": tokens,
	})
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var input domain.RefreshInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tokens, err := h.svc.Refresh(r.Context(), input.RefreshToken, r.RemoteAddr, r.UserAgent())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, tokens)
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var input domain.ForgotPasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Always return 200 to not reveal email existence
	_ = h.svc.ForgotPassword(r.Context(), input)
	auditRecordEnhanced(r, uuid.Nil, "user.forgot_password", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email})
	writeJSON(w, http.StatusOK, map[string]string{"message": "if the email exists, a reset link has been sent"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var input domain.ResetPasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	userID, userEmail, err := h.svc.ResetPassword(r.Context(), input)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.password_reset", "user", userID, userEmail, map[string]any{"method": "token", "email": userEmail})
	writeJSON(w, http.StatusOK, map[string]string{"message": "password reset successful"})
}

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "missing verification token")
		return
	}

	userID, userEmail, err := h.svc.VerifyEmail(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid or expired verification link")
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.email_verified", "user", userID, userEmail, map[string]any{"email": userEmail})
	writeJSON(w, http.StatusOK, map[string]string{"message": "email verified"})
}

func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	user, err := h.svc.GetMe(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.UpdateProfileInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch before state for diff
	beforeUser, _ := h.svc.GetMe(r.Context(), uc.UserID)

	user, err := h.svc.UpdateProfile(r.Context(), uc.UserID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}

	meta := map[string]any{}
	if beforeUser != nil {
		before := map[string]any{"display_name": beforeUser.DisplayName, "avatar_url": beforeUser.AvatarURL, "timezone": beforeUser.Timezone, "date_format": beforeUser.DateFormat, "time_format": beforeUser.TimeFormat}
		after := map[string]any{"display_name": user.DisplayName, "avatar_url": user.AvatarURL, "timezone": user.Timezone, "date_format": user.DateFormat, "time_format": user.TimeFormat}
		meta["before"] = before
		meta["after"] = after
	}
	auditRecordEnhanced(r, uuid.Nil, "user.profile_updated", "user", uc.UserID, uc.Email, meta)
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) GetDateTimeSettings(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	user, err := h.svc.GetMe(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load user")
		return
	}
	tz := h.cfg.Defaults.Timezone
	if tz == "" { tz = "UTC" }
	df := h.cfg.Defaults.DateFormat
	if df == "" { df = "YYYY-MM-DD" }
	tf := h.cfg.Defaults.TimeFormat
	if tf == "" { tf = "24h" }
	if user.Timezone != nil && *user.Timezone != "" { tz = *user.Timezone }
	if user.DateFormat != nil && *user.DateFormat != "" { df = *user.DateFormat }
	if user.TimeFormat != nil && *user.TimeFormat != "" { tf = *user.TimeFormat }
	writeJSON(w, http.StatusOK, map[string]string{
		"timezone":    tz,
		"date_format": df,
		"time_format": tf,
	})
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.ChangePasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Revoke all refresh sessions on password change. The current access token
	// remains valid until expiry; the middleware's password_changed_at check
	// ensures tokens issued before the change are rejected on next refresh.
	if err := h.svc.ChangePassword(r.Context(), uc.UserID, input, uuid.Nil); err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.password_changed", "user", uc.UserID, uc.Email, map[string]any{"email": uc.Email, "sessions_revoked": true})
	writeJSON(w, http.StatusOK, map[string]string{"message": "password changed"})
}

func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.DeleteAccountInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch user before deletion for display_name
	displayName := ""
	if user, err := h.svc.GetMe(r.Context(), uc.UserID); err == nil && user != nil {
		displayName = user.DisplayName
	}

	if err := h.svc.DeleteAccount(r.Context(), uc.UserID, input.Password); err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.account_deleted", "user", uc.UserID, uc.Email, map[string]any{"email": uc.Email, "display_name": displayName})
	writeJSON(w, http.StatusOK, map[string]string{"message": "account deleted"})
}

func (h *AuthHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	sessions, err := h.svc.ListSessions(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *AuthHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	sessionID, err := uuid.Parse(chi.URLParam(r, "sessionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	// Fetch session details before revocation for audit
	sessionIP := ""
	sessionUA := ""
	if sess, err := h.svc.GetSession(r.Context(), uc.UserID, sessionID); err == nil && sess != nil {
		if sess.IPAddress != nil {
			sessionIP = *sess.IPAddress
		}
		if sess.UserAgent != nil {
			sessionUA = *sess.UserAgent
		}
	}

	if err := h.svc.RevokeSession(r.Context(), uc.UserID, sessionID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke session")
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "session.revoked", "session", sessionID, uc.Email, map[string]any{"session_id": sessionID.String(), "session_ip": sessionIP, "session_user_agent": sessionUA})
	writeJSON(w, http.StatusOK, map[string]string{"message": "session revoked"})
}

func (h *AuthHandler) RevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	count, err := h.svc.RevokeAllSessions(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke sessions")
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "session.revoked_all", "session", uc.UserID, uc.Email, map[string]any{"email": uc.Email, "revoked_count": count})
	writeJSON(w, http.StatusOK, map[string]string{"message": "all sessions revoked"})
}

func (h *AuthHandler) SSOStatus(w http.ResponseWriter, r *http.Request) {
	enabled := h.sso.IsConfigured()
	providers := h.sso.ListProviders()

	resp := map[string]any{
		"enabled":            enabled,
		"allow_registration": h.cfg.Defaults.AllowRegistration,
		"providers":          providers,
	}

	// Check if org enforces SSO
	resp["enforce_sso"] = false
	orgs, _, err := h.svc.ListAllOrgs(r.Context(), 1, 1)
	if err == nil && len(orgs) > 0 && orgs[0].Settings.EnforceSSO != nil && *orgs[0].Settings.EnforceSSO {
		resp["enforce_sso"] = true
	}

	resp["password_policy"] = map[string]any{
		"min_length":        h.cfg.Password.MinLength,
		"require_uppercase": h.cfg.Password.RequireUppercase,
		"require_lowercase": h.cfg.Password.RequireLowercase,
		"require_number":    h.cfg.Password.RequireNumber,
		"require_special":   h.cfg.Password.RequireSpecial,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *AuthHandler) SSORedirect(w http.ResponseWriter, r *http.Request) {
	providerName := chi.URLParam(r, "provider")
	if !h.sso.IsProviderConfigured(providerName) {
		writeError(w, http.StatusNotFound, "SSO provider not configured")
		return
	}
	state, err := h.sso.GenerateState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}

	// Read intent (empty = login, "link" = account linking)
	intent := r.URL.Query().Get("intent")

	// Capture the frontend origin so the callback can redirect back
	origin := r.Header.Get("Origin")
	if origin == "" {
		if ref := r.Header.Get("Referer"); ref != "" {
			if u, err := url.Parse(ref); err == nil {
				origin = u.Scheme + "://" + u.Host
			}
		}
	}
	if origin == "" {
		origin = h.cfg.Server.FrontendURL // fallback to config
	}

	// Validate origin against allowed origins
	validOrigin := false
	for _, allowed := range h.cfg.CORS.AllowedOrigins {
		if origin == allowed {
			validOrigin = true
			break
		}
	}
	if !validOrigin {
		origin = h.cfg.Server.FrontendURL
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}

	// Store state + intent + user_id (if linking) in cookie
	stateValue := state
	if intent == "link" {
		uc := auth.GetUser(r.Context())
		if uc != nil {
			stateValue = state + "|link|" + uc.UserID.String()
		} else {
			stateValue = state + "|link|"
		}
	}

	http.SetCookie(w, &http.Cookie{
		Name: "sso_state", Value: stateValue, Path: "/", MaxAge: 600,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: scheme == "https",
	})
	http.SetCookie(w, &http.Cookie{
		Name: "sso_origin", Value: origin, Path: "/", MaxAge: 600,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: scheme == "https",
	})
	redirectURL, err := h.sso.RedirectURL(r.Context(), providerName, state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (h *AuthHandler) SSOCallback(w http.ResponseWriter, r *http.Request) {
	providerName := chi.URLParam(r, "provider")
	if !h.sso.IsProviderConfigured(providerName) {
		writeError(w, http.StatusNotFound, "SSO provider not configured")
		return
	}
	cookie, err := r.Cookie("sso_state")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing state cookie")
		return
	}

	// Parse state cookie: may be "state" or "state|link|userID"
	cookieValue := cookie.Value
	stateParam := r.URL.Query().Get("state")
	intent := ""
	linkUserID := ""

	parts := strings.SplitN(cookieValue, "|", 3)
	if len(parts) >= 2 {
		if parts[0] != stateParam {
			writeError(w, http.StatusBadRequest, "invalid state parameter")
			return
		}
		intent = parts[1]
		if len(parts) == 3 {
			linkUserID = parts[2]
		}
	} else {
		if cookieValue != stateParam {
			writeError(w, http.StatusBadRequest, "invalid state parameter")
			return
		}
	}

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{Name: "sso_state", Path: "/", MaxAge: -1})

	// Read and clear origin cookie
	frontendURL := h.cfg.Server.FrontendURL
	if oc, err := r.Cookie("sso_origin"); err == nil && oc.Value != "" {
		if oc.Value == h.cfg.Server.FrontendURL {
			frontendURL = oc.Value
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "sso_origin", Path: "/", MaxAge: -1})

	result, err := h.sso.HandleCallback(r.Context(), providerName, r)
	if err != nil {
		auditRecordEnhanced(r, uuid.Nil, "user.sso_login_failed", "user", uuid.Nil, "", map[string]any{
			"provider": providerName, "reason": err.Error(), "ip_address": r.RemoteAddr,
		})
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Handle link intent
	if intent == "link" && linkUserID != "" {
		userID, parseErr := uuid.Parse(linkUserID)
		if parseErr != nil {
			slog.Warn("invalid linkUserID in SSO callback state", "linkUserID", linkUserID, "provider", providerName, "ip", r.RemoteAddr)
			writeError(w, http.StatusBadRequest, "invalid user ID in link intent")
			return
		}
		if err := h.svc.LinkSSOIdentity(r.Context(), userID, result); err != nil {
			writeServiceError(w, err)
			return
		}
		auditRecordEnhanced(r, uuid.Nil, "user.sso_linked", "user", userID, result.Email, map[string]any{
			"provider": providerName, "subject": result.Subject,
		})
		http.Redirect(w, r, frontendURL+"/profile?sso_linked="+providerName, http.StatusFound)
		return
	}

	// Default: login intent
	user, tokens, err := h.svc.SSOLogin(r.Context(), result, r.RemoteAddr, r.UserAgent())
	if err != nil {
		var limitErr *service.SessionLimitError
		if errors.As(err, &limitErr) {
			auditRecordEnhanced(r, uuid.Nil, "user.login_session_conflict", "user", uuid.Nil, result.Email, map[string]any{
				"email": result.Email, "provider": providerName, "active_sessions": len(limitErr.Sessions), "limit": limitErr.Limit,
			})
			// Redirect to login page with session conflict data in hash fragment
			http.Redirect(w, r, fmt.Sprintf("%s/login#session_conflict=true&pending_token=%s&limit=%d",
				frontendURL,
				url.QueryEscape(limitErr.PendingToken),
				limitErr.Limit), http.StatusFound)
			return
		}
		auditRecordEnhanced(r, uuid.Nil, "user.sso_login_failed", "user", uuid.Nil, result.Email, map[string]any{
			"provider": providerName, "reason": err.Error(), "email": result.Email,
		})
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.sso_login", "user", user.ID, user.Email, map[string]any{
		"email": user.Email, "provider": providerName, "subject": result.Subject, "is_new_user": user.CreatedAt.After(time.Now().Add(-10*time.Second)),
	})

	http.Redirect(w, r, fmt.Sprintf("%s/login#access_token=%s&refresh_token=%s&user_id=%s",
		frontendURL,
		url.QueryEscape(tokens.AccessToken),
		url.QueryEscape(tokens.RefreshToken),
		url.QueryEscape(user.ID.String())), http.StatusFound)
}

func (h *AuthHandler) GetPendingSessions(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	sessions, limit, err := h.svc.GetPendingSessions(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions": sessions,
		"limit":    limit,
	})
}

func (h *AuthHandler) ListSSOIdentities(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	identities, err := h.svc.GetSSOIdentities(r.Context(), uc.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list SSO identities")
		return
	}
	if identities == nil {
		identities = []domain.SSOIdentity{}
	}
	writeJSON(w, http.StatusOK, identities)
}

func (h *AuthHandler) UnlinkSSO(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	provider := chi.URLParam(r, "provider")
	if provider == "" {
		writeError(w, http.StatusBadRequest, "provider is required")
		return
	}

	if err := h.svc.UnlinkSSOIdentity(r.Context(), uc.UserID, provider); err != nil {
		writeServiceError(w, err)
		return
	}

	auditRecordEnhanced(r, uuid.Nil, "user.sso_unlinked", "user", uc.UserID, uc.Email, map[string]any{
		"provider": provider,
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "SSO identity unlinked"})
}

// Shared JSON helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	code := "error"
	switch status {
	case http.StatusBadRequest:
		code = "validation_error"
	case http.StatusUnauthorized:
		code = "unauthenticated"
	case http.StatusForbidden:
		code = "forbidden"
	case http.StatusNotFound:
		code = "not_found"
	case http.StatusConflict:
		code = "conflict"
	case http.StatusTooManyRequests:
		code = "rate_limited"
	case http.StatusInternalServerError:
		code = "internal_error"
	}
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}
