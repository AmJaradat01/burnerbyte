package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/mailer"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// stripPort extracts the host/IP from a "host:port" string.
// If there is no port, returns the input unchanged.
func stripPort(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

type AuthService struct {
	pool              *pgxpool.Pool
	userRepo          *postgres.UserRepo
	sessionRepo       *postgres.SessionRepo
	resetRepo         *postgres.PasswordResetRepo
	emailVerifyRepo   *postgres.EmailVerificationRepo
	orgRepo           *postgres.OrgRepo
	ssoIdentityRepo   *postgres.SSOIdentityRepo
	ssoProviderRepo   *postgres.SSOProviderRepo
	teamRepo          *postgres.TeamRepo
	domainMappingRepo *postgres.SSODomainMappingRepo
	tokens            *auth.TokenManager
	lockout           *auth.Lockout
	mailer            *mailer.Mailer
	cfg               *config.Config
}

func NewAuthService(
	pool *pgxpool.Pool,
	userRepo *postgres.UserRepo,
	sessionRepo *postgres.SessionRepo,
	resetRepo *postgres.PasswordResetRepo,
	emailVerifyRepo *postgres.EmailVerificationRepo,
	orgRepo *postgres.OrgRepo,
	ssoIdentityRepo *postgres.SSOIdentityRepo,
	ssoProviderRepo *postgres.SSOProviderRepo,
	teamRepo *postgres.TeamRepo,
	domainMappingRepo *postgres.SSODomainMappingRepo,
	tokens *auth.TokenManager,
	lockout *auth.Lockout,
	mailer *mailer.Mailer,
	cfg *config.Config,
) *AuthService {
	return &AuthService{
		pool: pool, userRepo: userRepo, sessionRepo: sessionRepo,
		resetRepo: resetRepo, emailVerifyRepo: emailVerifyRepo, orgRepo: orgRepo,
		ssoIdentityRepo: ssoIdentityRepo, ssoProviderRepo: ssoProviderRepo, teamRepo: teamRepo,
		domainMappingRepo: domainMappingRepo,
		tokens: tokens, lockout: lockout, mailer: mailer, cfg: cfg,
	}
}

func (s *AuthService) Register(ctx context.Context, input domain.CreateUserInput) (*domain.User, *domain.TokenPair, error) {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if _, err := mail.ParseAddress(input.Email); err != nil {
		return nil, nil, fmt.Errorf("invalid email format")
	}

	if err := auth.ValidatePassword(input.Password, s.cfg.Password); err != nil {
		return nil, nil, err
	}

	// Invite-only mode enforcement: when registration is restricted, require a pending invite
	if !s.cfg.Defaults.AllowRegistration {
		if s.orgRepo == nil {
			slog.Warn("invite-only registration rejected: orgRepo not configured", "email", input.Email)
			return nil, nil, fmt.Errorf("registration requires an invite")
		}
		invite, err := s.orgRepo.GetPendingInviteByEmail(ctx, input.Email)
		if err != nil {
			slog.Info("invite-only registration rejected: no pending invite", "email", input.Email)
			return nil, nil, fmt.Errorf("registration requires an invite")
		}
		if !isAuthMethodAllowed(invite.AllowedAuth, "password") {
			slog.Info("invite-only registration rejected: password auth not allowed",
				"email", input.Email, "allowed_auth", invite.AllowedAuth)
			return nil, nil, fmt.Errorf("password registration is not allowed for this invite; allowed methods: %v", invite.AllowedAuth)
		}
	}

	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now()
	user := &domain.User{
		ID:                uuid.New(),
		Email:             input.Email,
		DisplayName:       input.DisplayName,
		PasswordHash:      &hash,
		IsSystemAdmin:     false,
		EmailVerified:     false,
		PasswordChangedAt: &now,
	}

	var tokenPair *domain.TokenPair
	pgxTx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer pgxTx.Rollback(ctx)

	userRepoTx := s.userRepo.WithTx(pgxTx)
	sessionRepoTx := s.sessionRepo.WithTx(pgxTx)

	if err := userRepoTx.Create(ctx, user); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return nil, nil, fmt.Errorf("email already registered")
		}
		return nil, nil, err
	}

	tokenPair, err = s.createSession(ctx, sessionRepoTx, user, "", "", nil)
	if err != nil {
		return nil, nil, err
	}

	if err := pgxTx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit: %w", err)
	}

	// Send verification email (non-blocking)
	if s.cfg.EmailVerification.Enabled {
		go func() {
			token := generateSecureToken(32)
			tokenHash := postgres.HashToken(token)
			expiresAt := time.Now().Add(24 * time.Hour)
			if err := s.emailVerifyRepo.Create(context.Background(), user.ID, tokenHash, expiresAt); err != nil {
				slog.Error("failed to create email verification token", "error", err, "user_id", user.ID)
				return
			}
			verifyURL := fmt.Sprintf("%s/verify-email?token=%s", s.cfg.Server.FrontendURL, token)
			if err := s.mailer.Send(user.Email, "Verify your email", "verify_email.html", map[string]string{
				"VerifyURL": verifyURL,
			}); err != nil {
				slog.Error("failed to send verification email", "error", err, "email", user.Email)
			}
		}()
	}

	return user, tokenPair, nil
}

func (s *AuthService) Login(ctx context.Context, input domain.LoginInput, ip, userAgent string) (*domain.User, *domain.TokenPair, error) {
	ip = stripPort(ip)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, nil, fmt.Errorf("invalid email or password")
		}
		return nil, nil, err
	}

	// Check lockout
	locked, retryAfter, err := s.lockout.IsLocked(ctx, user.ID)
	if err != nil {
		slog.Error("lockout check failed", "error", err)
	}
	if locked {
		return nil, nil, &LockedError{RetryAfter: retryAfter}
	}

	if user.PasswordHash == nil {
		return nil, nil, fmt.Errorf("account uses SSO login only")
	}

	if !auth.CheckPassword(*user.PasswordHash, input.Password) {
		wasLocked, _ := s.lockout.RecordFailure(ctx, user.ID)
		if wasLocked {
			go func() {
				_ = s.mailer.Send(user.Email, "Account locked", "lockout.html", map[string]string{
					"Attempts": fmt.Sprintf("%d", s.cfg.Lockout.MaxAttempts),
					"Duration": s.cfg.Lockout.Duration.String(),
				})
			}()
		}
		return nil, nil, fmt.Errorf("invalid email or password")
	}

	// Reset lockout on success
	_ = s.lockout.Reset(ctx, user.ID)

	// Check enforce_sso: if any of user's orgs enforce SSO, reject password login
	// Enhanced: only block users who have linked SSO identities
	var enforced bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM organizations o JOIN org_memberships m ON m.org_id = o.id
			WHERE m.user_id = $1 AND (o.settings->>'enforce_sso')::boolean = true
		)`, user.ID).Scan(&enforced); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fmt.Errorf("failed to check SSO enforcement: %w", err)
	}
	if enforced && s.ssoIdentityRepo != nil {
		identities, idErr := s.ssoIdentityRepo.ListByUser(ctx, user.ID)
		if idErr == nil && len(identities) > 0 {
			return nil, nil, fmt.Errorf("SSO login required for your organization")
		}
	} else if enforced {
		return nil, nil, fmt.Errorf("SSO login required for your organization")
	}

	tokenPair, err := s.createSession(ctx, s.sessionRepo, user, ip, userAgent, nil)
	if err != nil {
		return nil, nil, err
	}

	return user, tokenPair, nil
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken, ip, userAgent string) (*domain.TokenPair, error) {
	ip = stripPort(ip)
	hash := auth.HashToken(refreshToken)

	session, err := s.sessionRepo.GetByTokenHash(ctx, hash)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, fmt.Errorf("invalid refresh token")
		}
		return nil, err
	}

	// Token reuse detection — if session is revoked, revoke entire family
	if session.Revoked {
		slog.Warn("refresh token reuse detected, revoking family",
			"family", session.TokenFamily, "user_id", session.UserID)
		_ = s.sessionRepo.RevokeByFamily(ctx, session.TokenFamily)
		return nil, fmt.Errorf("refresh token reused — all sessions revoked")
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, fmt.Errorf("refresh token expired")
	}

	// Revoke old session
	if err := s.sessionRepo.Revoke(ctx, session.ID); err != nil {
		return nil, err
	}

	user, err := s.userRepo.GetByID(ctx, session.UserID)
	if err != nil {
		return nil, err
	}

	// Create new session in same family
	rawRefresh, refreshHash, err := s.tokens.GenerateRefreshToken()
	if err != nil { return nil, fmt.Errorf("generate refresh token: %w", err) }
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email, user.IsSystemAdmin)
	if err != nil {
		return nil, err
	}

	newSession := &domain.Session{
		ID:               uuid.New(),
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		TokenFamily:      session.TokenFamily, // same family
		IPAddress:        &ip,
		UserAgent:        &userAgent,
		ExpiresAt:        time.Now().Add(s.tokens.RefreshTTL()),
	}

	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return nil, err
	}

	return &domain.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.tokens.AccessTTL().Seconds()),
	}, nil
}

func (s *AuthService) GetMe(ctx context.Context, userID uuid.UUID) (*domain.User, error) {
	return s.userRepo.GetByID(ctx, userID)
}

func (s *AuthService) UpdateProfile(ctx context.Context, userID uuid.UUID, input domain.UpdateProfileInput) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	if input.DisplayName != nil {
		user.DisplayName = *input.DisplayName
	}
	if input.AvatarURL != nil {
		user.AvatarURL = input.AvatarURL
	}
	if input.Timezone != nil {
		user.Timezone = input.Timezone
	}
	if input.DateFormat != nil {
		user.DateFormat = input.DateFormat
	}
	if input.TimeFormat != nil {
		user.TimeFormat = input.TimeFormat
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) ChangePassword(ctx context.Context, userID uuid.UUID, input domain.ChangePasswordInput, currentSessionID uuid.UUID) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	if user.PasswordHash == nil {
		return fmt.Errorf("account uses SSO — no password to change")
	}

	if !auth.CheckPassword(*user.PasswordHash, input.CurrentPassword) {
		return fmt.Errorf("current password is incorrect")
	}

	if err := auth.ValidatePassword(input.NewPassword, s.cfg.Password); err != nil {
		return err
	}

	hash, err := auth.HashPassword(input.NewPassword)
	if err != nil {
		return err
	}

	now := time.Now()
	user.PasswordHash = &hash
	user.PasswordChangedAt = &now

	if err := s.userRepo.Update(ctx, user); err != nil {
		return err
	}

	// Revoke all sessions except current
	return s.sessionRepo.RevokeAllExcept(ctx, userID, currentSessionID)
}

func (s *AuthService) DeleteAccount(ctx context.Context, userID uuid.UUID, password string) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	if user.PasswordHash != nil && !auth.CheckPassword(*user.PasswordHash, password) {
		return fmt.Errorf("incorrect password")
	}

	return s.userRepo.Delete(ctx, userID)
}

func (s *AuthService) ListSessions(ctx context.Context, userID uuid.UUID) ([]domain.Session, error) {
	return s.sessionRepo.ListByUser(ctx, userID)
}

func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	return s.sessionRepo.RevokeForUser(ctx, userID, sessionID)
}

func (s *AuthService) GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*domain.Session, error) {
	return s.sessionRepo.GetByIDForUser(ctx, userID, sessionID)
}

func (s *AuthService) RevokeAllSessions(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.sessionRepo.RevokeAllCount(ctx, userID)
}

func (s *AuthService) ForgotPassword(ctx context.Context, input domain.ForgotPasswordInput) error {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		return nil // Don't reveal whether email exists
	}

	// Invalidate any existing tokens
	_ = s.resetRepo.InvalidateForUser(ctx, user.ID)

	// Generate and store hashed token
	rawToken := generateSecureToken(32)
	tokenHash := postgres.HashToken(rawToken)
	ttl := s.cfg.Defaults.PasswordResetTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	expiresAt := time.Now().Add(ttl)

	if err := s.resetRepo.Create(ctx, user.ID, tokenHash, expiresAt); err != nil {
		slog.Error("failed to store reset token", "error", err)
		return nil
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", s.cfg.Server.FrontendURL, rawToken)
	slog.Info("password reset requested", "user_id", user.ID)

	go func() {
		_ = s.mailer.Send(user.Email, "Reset your password", "password_reset.html", map[string]string{
			"ResetURL":  resetURL,
			"ExpiresIn": mailer.HumanDuration(ttl),
		})
	}()

	return nil
}

func (s *AuthService) ResetPassword(ctx context.Context, input domain.ResetPasswordInput) (uuid.UUID, string, error) {
	if input.Token == "" || input.NewPassword == "" {
		return uuid.Nil, "", fmt.Errorf("token and new_password are required")
	}

	if err := auth.ValidatePassword(input.NewPassword, s.cfg.Password); err != nil {
		return uuid.Nil, "", err
	}

	tokenHash := postgres.HashToken(input.Token)
	resetToken, err := s.resetRepo.Consume(ctx, tokenHash)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("invalid or expired reset token")
	}

	user, err := s.userRepo.GetByID(ctx, resetToken.UserID)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("user not found")
	}

	hash, err := auth.HashPassword(input.NewPassword)
	if err != nil {
		return uuid.Nil, "", err
	}

	now := time.Now()
	user.PasswordHash = &hash
	user.PasswordChangedAt = &now
	if err := s.userRepo.Update(ctx, user); err != nil {
		return uuid.Nil, "", err
	}
	// Revoke all sessions so stolen refresh tokens can't mint new access tokens
	return user.ID, user.Email, s.sessionRepo.RevokeAll(ctx, user.ID)
}

func (s *AuthService) SSOLogin(ctx context.Context, result *domain.SSOCallbackResult, ip, userAgent string) (*domain.User, *domain.TokenPair, error) {
	ip = stripPort(ip)
	email := strings.ToLower(result.Email)

	// Check allowed domains from provider config (if ssoProviderRepo is available)
	if s.ssoProviderRepo != nil {
		provCfg, err := s.ssoProviderRepo.GetByName(ctx, result.Provider)
		if err == nil && provCfg.AllowedDomains != "" {
			parts := strings.Split(email, "@")
			if len(parts) != 2 {
				return nil, nil, fmt.Errorf("invalid email")
			}
			emailDomain := parts[1]
			allowed := false
			for _, d := range strings.Split(provCfg.AllowedDomains, ",") {
				if strings.TrimSpace(d) == emailDomain {
					allowed = true
					break
				}
			}
			if !allowed {
				return nil, nil, fmt.Errorf("email domain %s is not allowed for SSO", emailDomain)
			}
		}
	}

	// Fallback: check global SSO config allowed domains
	if s.ssoProviderRepo == nil {
		ssoCfg := s.cfg.SSO
		if ssoCfg.AllowedDomains != "" {
			parts := strings.Split(email, "@")
			if len(parts) != 2 {
				return nil, nil, fmt.Errorf("invalid email")
			}
			emailDomain := parts[1]
			allowed := false
			for _, d := range strings.Split(ssoCfg.AllowedDomains, ",") {
				if strings.TrimSpace(d) == emailDomain {
					allowed = true
					break
				}
			}
			if !allowed {
				return nil, nil, fmt.Errorf("email domain %s is not allowed for SSO", emailDomain)
			}
		}
	}

	isNew := false
	var user *domain.User

	// Look up identity via ssoIdentityRepo
	if s.ssoIdentityRepo != nil {
		identity, err := s.ssoIdentityRepo.GetByProviderSubject(ctx, result.Provider, result.Subject)
		if err == nil {
			// Identity found — update last_used_at and load user
			_ = s.ssoIdentityRepo.UpdateLastUsed(ctx, identity.ID)
			user, err = s.userRepo.GetByID(ctx, identity.UserID)
			if err != nil {
				return nil, nil, fmt.Errorf("load SSO user: %w", err)
			}
			if !user.EmailVerified {
				user.EmailVerified = true
				_ = s.userRepo.Update(ctx, user)
			}
			// Update legacy sso_provider field so admin UI shows correct auth method
			if user.SSOProvider == nil || *user.SSOProvider != result.Provider {
				user.SSOProvider = &result.Provider
				_ = s.userRepo.Update(ctx, user)
			}
		}
	}

	if user == nil {
		// Try by email
		var err error
		user, err = s.userRepo.GetByEmail(ctx, email)
		if err != nil {
			// New user — apply invite-only checks before creating
			isNew = true

			// Invite-only mode enforcement for new SSO users
			if !s.cfg.Defaults.AllowRegistration {
				// Step 1: Check domain mapping rules (bypass invite requirement)
				var domainMappingMatched bool
				if s.ssoProviderRepo != nil && s.domainMappingRepo != nil {
					provCfg, provErr := s.ssoProviderRepo.GetByName(ctx, result.Provider)
					if provErr == nil && provCfg != nil {
						parts := strings.Split(email, "@")
						if len(parts) == 2 {
							emailDomain := parts[1]
							mappings, mapErr := s.domainMappingRepo.FindMatchingRules(ctx, provCfg.ID, emailDomain)
							if mapErr == nil && len(mappings) > 0 {
								// Domain mapping found — auto-provision with ALL mapped teams
								domainMappingMatched = true
								provisionedUser, provErr := s.createAndProvisionFromMappings(ctx, result, mappings)
								if provErr != nil {
									return nil, nil, fmt.Errorf("domain mapping auto-provision failed: %w", provErr)
								}
								user = provisionedUser
								slog.Info("SSO domain mapping: auto-provisioned user",
									"email", email, "provider", result.Provider, "teams", len(mappings))
							}
						}
					}
				}

				// Step 2: If no domain mapping match, check for pending invite
				if !domainMappingMatched {
					if s.orgRepo == nil {
						slog.Info("invite-only SSO login rejected: no invite and no domain mapping",
							"email", email, "provider", result.Provider)
						return nil, nil, fmt.Errorf("registration requires an invite")
					}
					invite, invErr := s.orgRepo.GetPendingInviteByEmail(ctx, email)
					if invErr != nil {
						slog.Info("invite-only SSO login rejected: no pending invite and no domain mapping",
							"email", email, "provider", result.Provider)
						return nil, nil, fmt.Errorf("registration requires an invite")
					}
					providerKey := "sso:" + result.Provider
					if !isAuthMethodAllowed(invite.AllowedAuth, providerKey) {
						slog.Info("invite-only SSO login rejected: SSO provider not allowed by invite",
							"email", email, "provider", result.Provider, "allowed_auth", invite.AllowedAuth)
						return nil, nil, fmt.Errorf("SSO provider %s is not allowed for this invite; allowed methods: %v",
							result.Provider, invite.AllowedAuth)
					}
				}
			}

			// Create user if not already provisioned via domain mapping
			if user == nil {
				provider := result.Provider
				user = &domain.User{
					ID: uuid.New(), Email: email, DisplayName: result.DisplayName,
					SSOProvider:   &provider,
					IsSystemAdmin: false, EmailVerified: true,
					PasswordChangedAt: func() *time.Time { t := time.Now(); return &t }(),
				}
				if result.AvatarURL != "" {
					user.AvatarURL = &result.AvatarURL
				}
				if err := s.userRepo.Create(ctx, user); err != nil {
					return nil, nil, fmt.Errorf("create SSO user: %w", err)
				}
			}
		} else {
			// Existing user by email — auto-link SSO identity.
			// The email from the SSO provider is verified by the provider (GitHub, Google, etc.),
			// so it's safe to trust it as proof of identity.
			user.EmailVerified = true
			user.SSOProvider = &result.Provider
			if err := s.userRepo.Update(ctx, user); err != nil {
				return nil, nil, fmt.Errorf("link SSO: %w", err)
			}
		}

		// Create identity record if ssoIdentityRepo is available
		if s.ssoIdentityRepo != nil {
			identity := &domain.SSOIdentity{
				ID:          uuid.New(),
				UserID:      user.ID,
				Provider:    result.Provider,
				Subject:     result.Subject,
				Email:       email,
				DisplayName: result.DisplayName,
				Metadata:    result.Claims,
			}
			// Ignore conflict — identity may already exist from migration
			_ = s.ssoIdentityRepo.Create(ctx, identity)
		}
	}

	// Set avatar from picture claim only when user has no existing avatar
	if result.AvatarURL != "" && (user.AvatarURL == nil || *user.AvatarURL == "") {
		user.AvatarURL = &result.AvatarURL
		_ = s.userRepo.Update(ctx, user)
	}

	// Auto-provision into org
	if isNew && s.orgRepo != nil {
		// Check provider-level auto-provision first
		if s.ssoProviderRepo != nil {
			provCfg, err := s.ssoProviderRepo.GetByName(ctx, result.Provider)
			if err == nil && provCfg.AutoProvision {
				s.autoProvisionSSOFromProvider(ctx, user, provCfg)
				// Apply claim mappings
				if len(provCfg.ClaimMappings) > 0 && result.Claims != nil {
					s.applyClaimMappings(ctx, user.ID, result.Provider, result.Claims, provCfg.ClaimMappings)
				}
			}
		} else if s.cfg.SSO.AutoProvision {
			s.autoProvisionSSO(ctx, user, s.cfg.SSO)
		}
	}

	providerName := result.Provider
	tokenPair, err := s.createSession(ctx, s.sessionRepo, user, ip, userAgent, &providerName)
	if err != nil {
		return nil, nil, err
	}
	return user, tokenPair, nil
}

func (s *AuthService) autoProvisionSSOFromProvider(ctx context.Context, user *domain.User, provCfg *domain.SSOProvider) {
	orgs, _, err := s.orgRepo.ListAll(ctx, 1, 1)
	if err != nil || len(orgs) == 0 {
		return
	}
	role := provCfg.DefaultOrgRole
	if role == "" {
		role = "member"
	}
	_ = s.orgRepo.CreateMembership(ctx, &domain.OrgMembership{
		ID: uuid.New(), UserID: user.ID, OrgID: orgs[0].ID, Role: role,
	})
	slog.Info("SSO auto-provisioned user into org", "user", user.Email, "org", orgs[0].Name, "role", role)
}

func (s *AuthService) autoProvisionSSO(ctx context.Context, user *domain.User, ssoCfg config.SSOConfig) {
	orgs, _, err := s.orgRepo.ListAll(ctx, 1, 1)
	if err != nil || len(orgs) == 0 {
		return
	}
	role := ssoCfg.DefaultOrgRole
	if role == "" {
		role = "member"
	}
	_ = s.orgRepo.CreateMembership(ctx, &domain.OrgMembership{
		ID: uuid.New(), UserID: user.ID, OrgID: orgs[0].ID, Role: role,
	})
	slog.Info("SSO auto-provisioned user into org", "user", user.Email, "org", orgs[0].Name, "role", role)
}

func (s *AuthService) VerifyEmail(ctx context.Context, token string) (uuid.UUID, string, error) {
	tokenHash := postgres.HashToken(token)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	emailVerifyRepoTx := postgres.NewEmailVerificationRepo(tx)

	vt, err := emailVerifyRepoTx.Consume(ctx, tokenHash)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("invalid or expired verification link")
	}

	userRepoTx := s.userRepo.WithTx(tx)
	user, err := userRepoTx.GetByID(ctx, vt.UserID)
	if err != nil {
		return uuid.Nil, "", err
	}

	if !user.EmailVerified {
		user.EmailVerified = true
		if err := userRepoTx.Update(ctx, user); err != nil {
			return uuid.Nil, "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, "", fmt.Errorf("commit: %w", err)
	}

	// Invalidate remaining tokens outside transaction (best-effort)
	_ = s.emailVerifyRepo.InvalidateForUser(ctx, vt.UserID)

	return user.ID, user.Email, nil
}

// generateSecureToken creates a cryptographically random hex token.
func generateSecureToken(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func (s *AuthService) ListAllOrgs(ctx context.Context, page, perPage int) ([]domain.Organization, int, error) {
	if s.orgRepo == nil {
		return nil, 0, nil
	}
	return s.orgRepo.ListAll(ctx, page, perPage)
}

func (s *AuthService) ListAllUsers(ctx context.Context, page, perPage int) ([]domain.User, int, error) {
	return s.userRepo.ListAll(ctx, page, perPage)
}

func (s *AuthService) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	return s.userRepo.Delete(ctx, userID)
}

func (s *AuthService) AdminUpdateUser(ctx context.Context, userID uuid.UUID, displayName, avatarURL *string, isSystemAdmin, emailVerified *bool) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if displayName != nil {
		user.DisplayName = *displayName
	}
	if avatarURL != nil {
		user.AvatarURL = avatarURL
	}
	if isSystemAdmin != nil {
		user.IsSystemAdmin = *isSystemAdmin
	}
	if emailVerified != nil {
		user.EmailVerified = *emailVerified
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) createSession(ctx context.Context, repo *postgres.SessionRepo, user *domain.User, ip, userAgent string, ssoProviderName *string) (*domain.TokenPair, error) {
	ip = stripPort(ip)
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email, user.IsSystemAdmin)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, err := s.tokens.GenerateRefreshToken()
	if err != nil { return nil, fmt.Errorf("generate refresh token: %w", err) }

	var ipPtr, uaPtr *string
	if ip != "" {
		ipPtr = &ip
	}
	if userAgent != "" {
		uaPtr = &userAgent
	}

	session := &domain.Session{
		ID:               uuid.New(),
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		TokenFamily:      uuid.New(),
		IPAddress:        ipPtr,
		UserAgent:        uaPtr,
		SSOProviderName:  ssoProviderName,
		ExpiresAt:        time.Now().Add(s.tokens.RefreshTTL()),
	}

	if err := repo.Create(ctx, session); err != nil {
		return nil, err
	}

	return &domain.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(s.tokens.AccessTTL().Seconds()),
	}, nil
}

// LinkSSOIdentity links an SSO identity to an existing user.
func (s *AuthService) LinkSSOIdentity(ctx context.Context, userID uuid.UUID, result *domain.SSOCallbackResult) error {
	if s.ssoIdentityRepo == nil {
		return fmt.Errorf("SSO identity repository not configured")
	}

	// Check identity not already linked to another user
	existing, err := s.ssoIdentityRepo.GetByProviderSubject(ctx, result.Provider, result.Subject)
	if err == nil && existing.UserID != userID {
		return fmt.Errorf("this SSO identity is already linked to another account")
	}

	// Check user doesn't already have this provider linked
	_, err = s.ssoIdentityRepo.GetByUserAndProvider(ctx, userID, result.Provider)
	if err == nil {
		return fmt.Errorf("you already have a %s account linked", result.Provider)
	}

	identity := &domain.SSOIdentity{
		ID:          uuid.New(),
		UserID:      userID,
		Provider:    result.Provider,
		Subject:     result.Subject,
		Email:       strings.ToLower(result.Email),
		DisplayName: result.DisplayName,
		Metadata:    result.Claims,
	}
	if err := s.ssoIdentityRepo.Create(ctx, identity); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return fmt.Errorf("this SSO identity is already linked to another account")
		}
		return fmt.Errorf("link SSO identity: %w", err)
	}
	return nil
}

// UnlinkSSOIdentity removes an SSO identity from a user.
func (s *AuthService) UnlinkSSOIdentity(ctx context.Context, userID uuid.UUID, provider string) error {
	if s.ssoIdentityRepo == nil {
		return fmt.Errorf("SSO identity repository not configured")
	}

	// Check user has a password set
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found")
	}
	if user.PasswordHash == nil {
		return fmt.Errorf("you must set a password before unlinking SSO")
	}

	// Check enforce_sso is not enabled
	var enforced bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM organizations o JOIN org_memberships m ON m.org_id = o.id
			WHERE m.user_id = $1 AND (o.settings->>'enforce_sso')::boolean = true
		)`, userID).Scan(&enforced); err == nil && enforced {
		return fmt.Errorf("SSO is required by your organization")
	}

	return s.ssoIdentityRepo.Delete(ctx, userID, provider)
}

// GetSSOIdentities returns all SSO identities for a user.
func (s *AuthService) GetSSOIdentities(ctx context.Context, userID uuid.UUID) ([]domain.SSOIdentity, error) {
	if s.ssoIdentityRepo == nil {
		return nil, nil
	}
	return s.ssoIdentityRepo.ListByUser(ctx, userID)
}

// applyClaimMappings maps IdP group claims to org roles and team memberships.
func (s *AuthService) applyClaimMappings(ctx context.Context, userID uuid.UUID, provider string, claims map[string]any, mappings []domain.ClaimMapping) {
	for _, mapping := range mappings {
		claimVal, ok := claims[mapping.ClaimName]
		if !ok {
			continue
		}

		// Check if claim value matches (supports string or []string)
		matched := false
		switch v := claimVal.(type) {
		case string:
			matched = v == mapping.ClaimValue
		case []any:
			for _, item := range v {
				if str, ok := item.(string); ok && str == mapping.ClaimValue {
					matched = true
					break
				}
			}
		}

		if !matched {
			continue
		}

		// Apply org role
		if mapping.OrgRole != "" && s.orgRepo != nil {
			orgs, _, err := s.orgRepo.ListAll(ctx, 1, 1)
			if err == nil && len(orgs) > 0 {
				if err := s.orgRepo.UpdateMemberRole(ctx, userID, orgs[0].ID, mapping.OrgRole); err != nil {
					slog.Warn("failed to apply claim mapping org role", "user_id", userID, "org_id", orgs[0].ID, "role", mapping.OrgRole, "error", err)
				}
			}
		}

		// Apply team membership
		if mapping.TeamID != "" && mapping.TeamRole != "" && s.teamRepo != nil {
			teamID, err := uuid.Parse(mapping.TeamID)
			if err == nil {
				teamRole := mapping.TeamRole
				if teamRole == "" {
					teamRole = "member"
				}
				if err := s.teamRepo.CreateMembership(ctx, &domain.TeamMembership{
					ID:     uuid.New(),
					UserID: userID,
					TeamID: teamID,
					Role:   teamRole,
				}); err != nil {
					slog.Warn("failed to apply claim mapping team membership", "user_id", userID, "team_id", mapping.TeamID, "error", err)
				}
			}
		}
	}
}

// isAuthMethodAllowed checks whether a given auth method is permitted by the invite's allowed_auth list.
// It returns true if allowedAuth contains "any" or the specific method string.
func isAuthMethodAllowed(allowedAuth []string, method string) bool {
	if len(allowedAuth) == 0 {
		return true // empty defaults to "any"
	}
	for _, a := range allowedAuth {
		if a == "any" || a == method {
			return true
		}
	}
	return false
}

// createAndProvisionFromMappings creates a new user from SSO callback data and provisions
// org membership + team memberships based on ALL matching domain mapping rules.
// The org_role is taken from the first mapping rule. Team memberships are created for
// all matching rules; archived teams are skipped with a warning log.
func (s *AuthService) createAndProvisionFromMappings(ctx context.Context, result *domain.SSOCallbackResult, mappings []domain.SSODomainMapping) (*domain.User, error) {
	email := strings.ToLower(result.Email)
	provider := result.Provider

	user := &domain.User{
		ID:            uuid.New(),
		Email:         email,
		DisplayName:   result.DisplayName,
		SSOProvider:   &provider,
		IsSystemAdmin: false,
		EmailVerified: true,
		PasswordChangedAt: func() *time.Time { t := time.Now(); return &t }(),
	}
	if result.AvatarURL != "" {
		user.AvatarURL = &result.AvatarURL
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("create domain-mapped SSO user: %w", err)
	}

	// Create SSO identity record
	if s.ssoIdentityRepo != nil {
		identity := &domain.SSOIdentity{
			ID:          uuid.New(),
			UserID:      user.ID,
			Provider:    result.Provider,
			Subject:     result.Subject,
			Email:       email,
			DisplayName: result.DisplayName,
			Metadata:    result.Claims,
		}
		_ = s.ssoIdentityRepo.Create(ctx, identity)
	}

	// Use org_role from the first mapping
	orgRole := mappings[0].OrgRole
	if orgRole == "" {
		orgRole = "member"
	}

	// Find the org to provision into (first org, same as existing auto-provision logic)
	if s.orgRepo != nil {
		orgs, _, err := s.orgRepo.ListAll(ctx, 1, 1)
		if err == nil && len(orgs) > 0 {
			_ = s.orgRepo.CreateMembership(ctx, &domain.OrgMembership{
				ID: uuid.New(), UserID: user.ID, OrgID: orgs[0].ID, Role: orgRole,
			})
			slog.Info("domain mapping: provisioned user into org",
				"user", email, "org", orgs[0].Name, "role", orgRole)
		}
	}

	// Create team memberships for ALL matching rules
	if s.teamRepo != nil {
		for _, m := range mappings {
			team, err := s.teamRepo.GetByID(ctx, m.TeamID)
			if err != nil {
				slog.Warn("domain mapping: team not found, skipping",
					"team_id", m.TeamID, "user", email)
				continue
			}
			if team.IsArchived {
				slog.Warn("domain mapping: team is archived, skipping",
					"team_id", m.TeamID, "team_name", team.Name, "user", email)
				continue
			}
			teamRole := m.TeamRole
			if teamRole == "" {
				teamRole = "member"
			}
			if err := s.teamRepo.CreateMembership(ctx, &domain.TeamMembership{
				ID: uuid.New(), UserID: user.ID, TeamID: m.TeamID, Role: teamRole,
			}); err != nil {
				slog.Warn("domain mapping: failed to create team membership",
					"team_id", m.TeamID, "user", email, "error", err)
				continue
			}
			slog.Info("domain mapping: provisioned user into team",
				"user", email, "team", team.Name, "role", teamRole)
		}
	}

	return user, nil
}

// LockedError indicates the account is locked.
type LockedError struct {
	RetryAfter time.Duration
}

func (e *LockedError) Error() string {
	return fmt.Sprintf("account locked, retry after %s", e.RetryAfter)
}
