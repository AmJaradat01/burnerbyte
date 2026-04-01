package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

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
	r.Post("/auth/refresh", h.Refresh)
	r.With(rl.ForgotPasswordLimiter).Post("/auth/forgot-password", h.ForgotPassword)
	r.Post("/auth/reset-password", h.ResetPassword)
	r.Get("/auth/verify-email/{token}", h.VerifyEmail)
	r.Get("/auth/sso/{provider}", h.SSORedirect)
	r.Get("/auth/sso/{provider}/callback", h.SSOCallback)
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
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

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
			w.Header().Set("Retry-After", strconv.Itoa(int(lockedErr.RetryAfter.Seconds())))
			writeError(w, http.StatusLocked, err.Error())
			return
		}
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

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
	writeJSON(w, http.StatusOK, map[string]string{"message": "if the email exists, a reset link has been sent"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var input domain.ResetPasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.ResetPassword(r.Context(), input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "password reset successful"})
}

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	userID, err := uuid.Parse(token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid verification token")
		return
	}

	if err := h.svc.VerifyEmail(r.Context(), userID); err != nil {
		writeError(w, http.StatusNotFound, "verification failed")
		return
	}

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

	user, err := h.svc.UpdateProfile(r.Context(), uc.UserID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.ChangePasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Revoke all sessions on password change (uuid.Nil = no exclusion)
	if err := h.svc.ChangePassword(r.Context(), uc.UserID, input, uuid.Nil); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "password changed"})
}

func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	var input domain.DeleteAccountInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.DeleteAccount(r.Context(), uc.UserID, input.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

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

	if err := h.svc.RevokeSession(r.Context(), uc.UserID, sessionID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke session")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "session revoked"})
}

func (h *AuthHandler) RevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	uc := auth.GetUser(r.Context())
	if err := h.svc.RevokeAllSessions(r.Context(), uc.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke sessions")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "all sessions revoked"})
}

func (h *AuthHandler) SSOStatus(w http.ResponseWriter, r *http.Request) {
	enabled := h.sso.IsConfigured()
	resp := map[string]any{
		"enabled":            enabled,
		"allow_registration": h.cfg.Defaults.AllowRegistration,
	}
	if enabled {
		cfg := h.cfg.SSO
		resp["provider"] = cfg.Provider
		labels := map[string]string{"google": "Google", "github": "GitHub", "azure": "Microsoft", "okta": "Okta", "oidc": "SSO"}
		if l, ok := labels[cfg.Provider]; ok {
			resp["provider_label"] = l
		} else {
			resp["provider_label"] = "SSO"
		}
		// Check if org enforces SSO
		resp["enforce_sso"] = false
		orgs, _, err := h.svc.ListAllOrgs(r.Context(), 1, 1)
		if err == nil && len(orgs) > 0 && orgs[0].Settings.EnforceSSO != nil && *orgs[0].Settings.EnforceSSO {
			resp["enforce_sso"] = true
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *AuthHandler) SSORedirect(w http.ResponseWriter, r *http.Request) {
	if !h.sso.IsConfigured() {
		writeError(w, http.StatusNotFound, "SSO not configured")
		return
	}
	state, err := h.sso.GenerateState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}
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
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	http.SetCookie(w, &http.Cookie{
		Name: "sso_state", Value: state, Path: "/", MaxAge: 600,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: scheme == "https",
	})
	http.SetCookie(w, &http.Cookie{
		Name: "sso_origin", Value: origin, Path: "/", MaxAge: 600,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: scheme == "https",
	})
	url, err := h.sso.RedirectURL(r.Context(), state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.Redirect(w, r, url, http.StatusFound)
}

func (h *AuthHandler) SSOCallback(w http.ResponseWriter, r *http.Request) {
	if !h.sso.IsConfigured() {
		writeError(w, http.StatusNotFound, "SSO not configured")
		return
	}
	cookie, err := r.Cookie("sso_state")
	if err != nil || cookie.Value != r.URL.Query().Get("state") {
		writeError(w, http.StatusBadRequest, "invalid state parameter")
		return
	}
	// Clear state cookie
	http.SetCookie(w, &http.Cookie{Name: "sso_state", Path: "/", MaxAge: -1})

	// Read and clear origin cookie
	frontendURL := h.cfg.Server.FrontendURL
	if oc, err := r.Cookie("sso_origin"); err == nil && oc.Value != "" {
		frontendURL = oc.Value
	}
	http.SetCookie(w, &http.Cookie{Name: "sso_origin", Path: "/", MaxAge: -1})

	email, displayName, provider, subject, err := h.sso.HandleCallback(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	user, tokens, err := h.svc.SSOLogin(r.Context(), email, displayName, provider, subject, r.RemoteAddr, r.UserAgent())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Redirect to frontend with tokens as query params
	http.Redirect(w, r, fmt.Sprintf("%s/login?access_token=%s&refresh_token=%s&user_id=%s",
		frontendURL, tokens.AccessToken, tokens.RefreshToken, user.ID), http.StatusFound)
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
