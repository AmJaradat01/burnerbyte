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

// dbPool is the subset of *pgxpool.Pool the auth service uses — transactions
// and direct queries. Abstracting it lets the transactional flows (registration,
// login, password reset) be unit-tested without a live database. *pgxpool.Pool
// satisfies it, so production wiring is unchanged.
type dbPool interface {
	Begin(ctx context.Context) (pgx.Tx, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type AuthService struct {
	pool              dbPool
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
	revocationCache   *auth.SessionRevocationCache
	pendingLoginStore *auth.PendingLoginStore
	ssoCodeStore      *auth.SSOCodeStore
}

func NewAuthService(
	pool dbPool,
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
	revocationCache *auth.SessionRevocationCache,
	pendingLoginStore *auth.PendingLoginStore,
	ssoCodeStore *auth.SSOCodeStore,
) *AuthService {
	return &AuthService{
		pool: pool, userRepo: userRepo, sessionRepo: sessionRepo,
		resetRepo: resetRepo, emailVerifyRepo: emailVerifyRepo, orgRepo: orgRepo,
		ssoIdentityRepo: ssoIdentityRepo, ssoProviderRepo: ssoProviderRepo, teamRepo: teamRepo,
		domainMappingRepo: domainMappingRepo,
		tokens:            tokens, lockout: lockout, mailer: mailer, cfg: cfg,
		revocationCache:   revocationCache,
		pendingLoginStore: pendingLoginStore,
		ssoCodeStore:      ssoCodeStore,
	}
}

func (s *AuthService) StoreSSOCode(ctx context.Context, code string, tokens *domain.TokenPair, userID uuid.UUID) error {
	return s.ssoCodeStore.Store(ctx, code, tokens.AccessToken, tokens.RefreshToken, userID)
}

func (s *AuthService) ExchangeSSOCode(ctx context.Context, code string) (*auth.SSOCodeData, error) {
	return s.ssoCodeStore.Exchange(ctx, code)
}

func (s *AuthService) Register(ctx context.Context, input domain.CreateUserInput) (*domain.User, *domain.TokenPair, error) {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if _, err := mail.ParseAddress(input.Email); err != nil {
		return nil, nil, fmt.Errorf("invalid email format")
	}

	if err := auth.ValidateDisplayName(input.DisplayName); err != nil {
		return nil, nil, err
	}

	if err := auth.ValidatePassword(input.Password, s.cfg.PasswordPolicy()); err != nil {
		return nil, nil, err
	}

	// Invite-only mode enforcement: when registration is restricted, require a pending invite
	if !s.cfg.RuntimeDefaults().AllowRegistration {
		if s.orgRepo == nil {
			slog.Warn("invite-only registration rejected: orgRepo not configured", "email", input.Email)
			return nil, nil, fmt.Errorf("registration requires an invite")
		}
		// Validate by the invite token, not just the email: the token is the
		// proof of invitation. Matching on email alone let anyone who knew an
		// invited address pre-register it (squatting the invitee, blocking their
		// signup) with any non-empty token. Require a pending, unexpired invite
		// whose email matches the one being registered.
		invite, err := s.orgRepo.GetInviteByToken(ctx, input.InviteToken)
		if err != nil || invite.AcceptedAt != nil || time.Now().After(invite.ExpiresAt) ||
			!strings.EqualFold(invite.Email, input.Email) {
			slog.Info("invite-only registration rejected: no valid invite for email", "email", input.Email)
			return nil, nil, fmt.Errorf("registration requires a valid invite for this email address")
		}
		if !isAuthMethodAllowed(invite.AllowedAuth, "password") {
			slog.Info("invite-only registration rejected: password auth not allowed",
				"email", input.Email, "allowed_auth", invite.AllowedAuth)
			return nil, nil, fmt.Errorf("password registration is not allowed for this invite; allowed methods: %v", invite.AllowedAuth)
		}
	}

	hash, err := auth.HashPassword(input.Password, s.cfg.PasswordPolicy())
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
	if s.cfg.EmailVerificationEnabled() {
		go func() {
			token := generateSecureToken(32)
			tokenHash := postgres.HashToken(token)
			ttl := s.cfg.EmailVerification.TTL
			if ttl <= 0 {
				ttl = 24 * time.Hour
			}
			expiresAt := time.Now().Add(ttl)
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
			// Perform a dummy bcrypt comparison to prevent timing-based user enumeration.
			auth.DummyCheckPassword(input.Password)
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

	// Check auth method lock
	if err := checkAuthMethodLock(user, "password"); err != nil {
		return nil, nil, err
	}

	if user.PasswordHash == nil {
		return nil, nil, fmt.Errorf("account uses SSO login only")
	}

	if !auth.CheckPassword(*user.PasswordHash, input.Password) {
		wasLocked, _ := s.lockout.RecordFailure(ctx, user.ID)
		if wasLocked {
			go func() {
				_ = s.mailer.Send(user.Email, "Account locked", "lockout.html", map[string]string{
					"Attempts": fmt.Sprintf("%d", s.cfg.LockoutPolicy().MaxAttempts),
					"Duration": s.cfg.LockoutPolicy().Duration.String(),
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

	// ── Session limit check (interactive for password login) ──
	proceed, limitErr := s.enforceSessionLimit(ctx, user, ip, userAgent)
	if !proceed {
		return nil, nil, limitErr
	}

	tokenPair, err := s.createSessionDirect(ctx, s.sessionRepo, user, ip, userAgent)
	if err != nil {
		return nil, nil, err
	}

	s.updateLastLoginAt(ctx, user)

	return user, tokenPair, nil
}

// ResolveLogin completes a pending login by revoking the chosen session
// and creating a new session for the user.
func (s *AuthService) ResolveLogin(ctx context.Context, input domain.ResolveLoginInput, ip, userAgent string) (*domain.User, *domain.TokenPair, error) {
	ip = stripPort(ip)

	// Step 1: Consume pending token (single-use)
	pending, err := s.pendingLoginStore.Consume(ctx, input.PendingToken)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid or expired pending login token")
	}

	// Step 2: Log IP mismatch (security telemetry, non-blocking)
	if pending.IP != ip {
		slog.Warn("pending login IP mismatch",
			"user_id", pending.UserID,
			"original_ip", pending.IP,
			"resolve_ip", ip)
	}

	// Step 3: Load user
	user, err := s.userRepo.GetByID(ctx, pending.UserID)
	if err != nil {
		return nil, nil, fmt.Errorf("user not found")
	}

	// Step 4: Revoke the chosen session
	if err := s.sessionRepo.RevokeForUser(ctx, user.ID, input.RevokeSessionID); err != nil {
		return nil, nil, fmt.Errorf("failed to revoke session: %w", err)
	}

	// Step 5: Mark revocation for immediate token invalidation
	if s.revocationCache != nil {
		s.revocationCache.MarkRevoked(ctx, user.ID)
	}

	// Step 6: Re-check limit (handle race condition)
	limit := s.resolveSessionLimit(user)
	activeCount, err := s.sessionRepo.CountActiveByUser(ctx, user.ID)
	if err != nil {
		slog.Warn("failed to count sessions after resolve", "user_id", user.ID, "error", err)
		// Fall through — attempt session creation
	} else if activeCount >= limit {
		// Race condition: another login filled the slot
		sessions, _ := s.sessionRepo.ListByUser(ctx, user.ID)
		pendingToken, storeErr := s.pendingLoginStore.Store(ctx, auth.PendingLogin{
			UserID:    user.ID,
			IP:        pending.IP,
			UserAgent: pending.UserAgent,
		})
		if storeErr != nil {
			return nil, nil, fmt.Errorf("failed to store new pending login: %w", storeErr)
		}
		return nil, nil, &SessionLimitError{
			PendingToken: pendingToken,
			Sessions:     sessions,
			Limit:        limit,
		}
	}

	// Step 7: Create new session using original IP/UA from pending login
	tokenPair, err := s.createSessionDirect(ctx, s.sessionRepo, user, pending.IP, pending.UserAgent)
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

	// Check session auth method matches user's lock
	if err := checkSessionAuthMethodLock(user, session); err != nil {
		_ = s.sessionRepo.Revoke(ctx, session.ID)
		return nil, err
	}

	// Create new session in same family
	rawRefresh, refreshHash, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
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
		SSOProviderName:  session.SSOProviderName, // carry forward auth method
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
		if err := auth.ValidateDisplayName(*input.DisplayName); err != nil {
			return nil, err
		}
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

	if err := auth.ValidatePassword(input.NewPassword, s.cfg.PasswordPolicy()); err != nil {
		return err
	}

	hash, err := auth.HashPassword(input.NewPassword, s.cfg.PasswordPolicy())
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

	if user.PasswordHash != nil {
		// Password-based user: verify password
		if !auth.CheckPassword(*user.PasswordHash, password) {
			return fmt.Errorf("incorrect password")
		}
	} else {
		// SSO-only user: require a recent SSO session (no password to verify).
		// We reject the request because there's no way to confirm identity
		// without a password. The user must re-authenticate via SSO first.
		return fmt.Errorf("SSO-only accounts must re-authenticate via SSO before deletion")
	}

	slog.Info("account deleted", "user_id", userID, "email", user.Email)
	return s.userRepo.Delete(ctx, userID)
}

func (s *AuthService) ListSessions(ctx context.Context, userID uuid.UUID) ([]domain.Session, error) {
	return s.sessionRepo.ListByUser(ctx, userID)
}

func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	if err := s.sessionRepo.RevokeForUser(ctx, userID, sessionID); err != nil {
		return err
	}
	if s.revocationCache != nil {
		s.revocationCache.MarkRevoked(ctx, userID)
	}
	return nil
}

func (s *AuthService) GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*domain.Session, error) {
	return s.sessionRepo.GetByIDForUser(ctx, userID, sessionID)
}

func (s *AuthService) RevokeAllSessions(ctx context.Context, userID uuid.UUID) (int, error) {
	count, err := s.sessionRepo.RevokeAllCount(ctx, userID)
	if err != nil {
		return 0, err
	}
	if s.revocationCache != nil && count > 0 {
		s.revocationCache.MarkRevoked(ctx, userID)
	}
	return count, nil
}

// Logout revokes the session chain (token family) behind the given refresh
// token and returns the revoked session for auditing. Unknown tokens are a
// successful no-op so logout stays idempotent and reveals nothing about token
// validity.
func (s *AuthService) Logout(ctx context.Context, refreshToken string) (*domain.Session, error) {
	session, err := s.sessionRepo.GetByTokenHash(ctx, auth.HashToken(refreshToken))
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if err := s.sessionRepo.RevokeByFamily(ctx, session.TokenFamily); err != nil {
		return nil, err
	}
	if s.revocationCache != nil {
		s.revocationCache.MarkRevoked(ctx, session.UserID)
	}
	return session, nil
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
	ttl := s.cfg.RuntimeDefaults().PasswordResetTTL
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

	if err := auth.ValidatePassword(input.NewPassword, s.cfg.PasswordPolicy()); err != nil {
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

	hash, err := auth.HashPassword(input.NewPassword, s.cfg.PasswordPolicy())
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

	// Validate email format using net/mail (consistent with Register)
	emailDomain, err := extractEmailDomain(email)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid email from SSO provider")
	}

	// Check allowed domains from provider config (if ssoProviderRepo is available)
	if s.ssoProviderRepo != nil {
		provCfg, err := s.ssoProviderRepo.GetByName(ctx, result.Provider)
		if err == nil && provCfg.AllowedDomains != "" {
			if !isDomainAllowed(emailDomain, provCfg.AllowedDomains) {
				return nil, nil, fmt.Errorf("email domain %s is not allowed for SSO", emailDomain)
			}
		}
	}

	// Fallback: check global SSO config allowed domains
	if s.ssoProviderRepo == nil {
		ssoCfg := s.cfg.SSO
		if ssoCfg.AllowedDomains != "" {
			if !isDomainAllowed(emailDomain, ssoCfg.AllowedDomains) {
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
			// Check auth method lock for existing users
			if err := checkAuthMethodLock(user, "sso"); err != nil {
				return nil, nil, err
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
			if !s.cfg.RuntimeDefaults().AllowRegistration {
				// Step 1: Check domain mapping rules (bypass invite requirement)
				var domainMappingMatched bool
				if s.ssoProviderRepo != nil && s.domainMappingRepo != nil {
					provCfg, provErr := s.ssoProviderRepo.GetByName(ctx, result.Provider)
					if provErr == nil && provCfg != nil {
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
			// Existing account with this email. Only auto-link the SSO identity
			// when the provider asserted the email is verified — otherwise an
			// unverified-email assertion (e.g. a permissive OIDC provider, or a
			// secondary GitHub email) could take over an existing password
			// account. Explicit linking from the profile, where the user has
			// already authenticated, is unaffected and matches by subject.
			if !result.EmailVerified {
				return nil, nil, fmt.Errorf("this email address is not verified by %s, so it can't be linked to an existing account automatically. Sign in to that account, then link %s from your profile.", result.Provider, result.Provider)
			}
			// Check auth method lock for existing users
			if err := checkAuthMethodLock(user, "sso"); err != nil {
				return nil, nil, err
			}
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

	// ── Session limit check (interactive for SSO login) ──
	proceed, limitErr := s.enforceSessionLimit(ctx, user, ip, userAgent)
	if !proceed {
		return nil, nil, limitErr
	}

	providerName := result.Provider
	tokenPair, err := s.createSession(ctx, s.sessionRepo, user, ip, userAgent, &providerName)
	if err != nil {
		return nil, nil, err
	}

	s.updateLastLoginAt(ctx, user)

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

	// Assign to default team if configured
	if provCfg.DefaultTeamID != nil && s.teamRepo != nil {
		teamRole := provCfg.DefaultTeamRole
		if teamRole == "" {
			teamRole = "member"
		}
		_ = s.teamRepo.CreateMembership(ctx, &domain.TeamMembership{
			ID:     uuid.New(),
			UserID: user.ID,
			TeamID: *provCfg.DefaultTeamID,
			Role:   teamRole,
		})
		slog.Info("SSO auto-provisioned user into default team", "user", user.Email, "team_id", provCfg.DefaultTeamID.String(), "role", teamRole)
	}
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

func (s *AuthService) AdminUpdateUser(ctx context.Context, userID uuid.UUID, displayName, avatarURL *string, isSystemAdmin, emailVerified *bool, maxSessions *int) (*domain.User, error) {
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
	if maxSessions != nil {
		user.MaxSessions = maxSessions
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

// resolveSessionLimit returns the effective max sessions for a user.
// Uses the per-user override if set, otherwise falls back to the platform default.
func (s *AuthService) resolveSessionLimit(user *domain.User) int {
	if user.MaxSessions != nil && *user.MaxSessions >= 1 {
		return *user.MaxSessions
	}
	limit := s.cfg.RuntimeDefaults().MaxSessionsPerUser
	if limit <= 0 {
		return 5 // safety fallback
	}
	return limit
}

// extractEmailDomain parses an email address and returns the domain part,
// normalized to lowercase. Uses net/mail.ParseAddress for robust parsing.
func extractEmailDomain(email string) (string, error) {
	addr, err := mail.ParseAddress(email)
	if err != nil {
		return "", fmt.Errorf("invalid email: %w", err)
	}
	parts := strings.SplitN(addr.Address, "@", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid email format")
	}
	return strings.ToLower(parts[1]), nil
}

// isDomainAllowed checks whether an email domain is in a comma-separated allowlist.
func isDomainAllowed(emailDomain, allowedDomains string) bool {
	for _, d := range strings.Split(allowedDomains, ",") {
		if strings.TrimSpace(strings.ToLower(d)) == emailDomain {
			return true
		}
	}
	return false
}

// enforceSessionLimit checks whether the user has reached their session limit.
// If the limit is reached and a pendingLoginStore is available, it returns a
// SessionLimitError for interactive resolution. Otherwise it auto-revokes the
// oldest sessions to make room.
// Returns (true, nil) if the caller should proceed to create a session,
// or (false, err) if a SessionLimitError or other error should be returned.
func (s *AuthService) enforceSessionLimit(ctx context.Context, user *domain.User, ip, userAgent string) (proceed bool, err error) {
	limit := s.resolveSessionLimit(user)
	activeCount, countErr := s.sessionRepo.CountActiveByUser(ctx, user.ID)
	if countErr != nil {
		slog.Warn("failed to count active sessions for limit check",
			"user_id", user.ID, "error", countErr)
		return true, nil // best-effort: allow login on count failure
	}

	if activeCount < limit {
		return true, nil
	}

	// Limit reached — try interactive conflict resolution
	if s.pendingLoginStore != nil {
		sessions, listErr := s.sessionRepo.ListByUser(ctx, user.ID)
		if listErr != nil {
			return false, fmt.Errorf("failed to list sessions: %w", listErr)
		}
		pendingToken, storeErr := s.pendingLoginStore.Store(ctx, auth.PendingLogin{
			UserID:    user.ID,
			IP:        ip,
			UserAgent: userAgent,
		})
		if storeErr != nil {
			// Redis unavailable — fall back to auto-revoking oldest session
			slog.Warn("pending login store failed, falling back to auto-revoke",
				"user_id", user.ID, "error", storeErr)
		} else {
			return false, &SessionLimitError{
				PendingToken: pendingToken,
				Sessions:     sessions,
				Limit:        limit,
			}
		}
	}

	// Auto-revoke oldest sessions to make room
	revoked, revokeErr := s.sessionRepo.RevokeOldestExceeding(ctx, user.ID, limit-1)
	if revokeErr != nil {
		slog.Warn("auto-revoke failed",
			"user_id", user.ID, "limit", limit, "error", revokeErr)
	} else if revoked > 0 {
		slog.Info("revoked excess sessions due to session limit",
			"user_id", user.ID, "revoked", revoked, "limit", limit)
		if s.revocationCache != nil {
			s.revocationCache.MarkRevoked(ctx, user.ID)
		}
	}

	return true, nil
}

// updateLastLoginAt updates the user's last_login_at timestamp (best-effort).
func (s *AuthService) updateLastLoginAt(ctx context.Context, user *domain.User) {
	now := time.Now()
	user.LastLoginAt = &now
	if err := s.userRepo.Update(ctx, user); err != nil {
		slog.Warn("failed to update last_login_at", "user_id", user.ID, "error", err)
	}
}

func (s *AuthService) createSession(ctx context.Context, repo *postgres.SessionRepo, user *domain.User, ip, userAgent string, ssoProviderName *string) (*domain.TokenPair, error) {
	ip = stripPort(ip)
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email, user.IsSystemAdmin)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	// ── Session limit enforcement (best-effort) ──
	limit := s.resolveSessionLimit(user)
	activeCount, countErr := repo.CountActiveByUser(ctx, user.ID)
	if countErr != nil {
		slog.Warn("failed to count active sessions for limit enforcement",
			"user_id", user.ID, "error", countErr)
	} else if activeCount >= limit {
		revoked, revokeErr := repo.RevokeOldestExceeding(ctx, user.ID, limit-1)
		if revokeErr != nil {
			slog.Warn("failed to revoke excess sessions",
				"user_id", user.ID, "limit", limit, "error", revokeErr)
		} else if revoked > 0 {
			slog.Info("revoked excess sessions due to session limit",
				"user_id", user.ID, "revoked", revoked, "limit", limit)
			if s.revocationCache != nil {
				s.revocationCache.MarkRevoked(ctx, user.ID)
			}
		}
	}

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

// createSessionDirect creates a session without any session limit enforcement.
// Used by Login() (under-limit path) and ResolveLogin() after the caller has
// already verified there is room for a new session.
func (s *AuthService) createSessionDirect(ctx context.Context, repo *postgres.SessionRepo, user *domain.User, ip, userAgent string) (*domain.TokenPair, error) {
	ip = stripPort(ip)
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email, user.IsSystemAdmin)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, err := s.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

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

	// Check user-level auth method lock
	if user.AuthMethodLock != nil && *user.AuthMethodLock == "sso" {
		return fmt.Errorf("cannot unlink SSO: account is locked to SSO login only")
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
// All operations run inside a single transaction for atomicity.
func (s *AuthService) createAndProvisionFromMappings(ctx context.Context, result *domain.SSOCallbackResult, mappings []domain.SSODomainMapping) (*domain.User, error) {
	email := strings.ToLower(result.Email)
	provider := result.Provider

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	userRepoTx := s.userRepo.WithTx(tx)

	user := &domain.User{
		ID:                uuid.New(),
		Email:             email,
		DisplayName:       result.DisplayName,
		SSOProvider:       &provider,
		IsSystemAdmin:     false,
		EmailVerified:     true,
		PasswordChangedAt: func() *time.Time { t := time.Now(); return &t }(),
	}
	if result.AvatarURL != "" {
		user.AvatarURL = &result.AvatarURL
	}

	if err := userRepoTx.Create(ctx, user); err != nil {
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

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit domain mapping provisioning: %w", err)
	}

	return user, nil
}

// GetPendingSessions returns the active sessions for a pending login token without consuming it.
// Used by the SSO conflict flow to fetch session list for display in the frontend.
func (s *AuthService) GetPendingSessions(ctx context.Context, token string) ([]domain.Session, int, error) {
	pending, err := s.pendingLoginStore.Peek(ctx, token)
	if err != nil {
		return nil, 0, fmt.Errorf("invalid or expired pending login token")
	}
	user, err := s.userRepo.GetByID(ctx, pending.UserID)
	if err != nil {
		return nil, 0, fmt.Errorf("user not found")
	}
	sessions, err := s.sessionRepo.ListByUser(ctx, pending.UserID)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list sessions")
	}
	limit := s.resolveSessionLimit(user)
	return sessions, limit, nil
}

// LockedError indicates the account is locked.
type LockedError struct {
	RetryAfter time.Duration
}

func (e *LockedError) Error() string {
	return fmt.Sprintf("account locked, retry after %s", e.RetryAfter)
}

// SessionLimitError is returned by Login() when the session limit is reached
// and the user needs to choose which session to revoke.
type SessionLimitError struct {
	PendingToken string           `json:"pending_token"`
	Sessions     []domain.Session `json:"sessions"`
	Limit        int              `json:"limit"`
}

func (e *SessionLimitError) Error() string {
	return "session limit reached"
}

// checkAuthMethodLock returns an error if the user's auth method lock
// does not permit the given method ("password" or "sso").
// Returns nil if the lock is nil (any method allowed) or matches the method.
func checkAuthMethodLock(user *domain.User, method string) error {
	if user.AuthMethodLock == nil {
		return nil
	}
	lock := *user.AuthMethodLock
	if lock == method {
		return nil
	}
	switch lock {
	case "sso":
		return fmt.Errorf("account is locked to SSO login only")
	case "password":
		return fmt.Errorf("account is locked to password login only")
	default:
		return fmt.Errorf("account has unknown auth method lock: %s", lock)
	}
}

// checkSessionAuthMethodLock verifies that a session's auth method matches
// the user's auth method lock. Returns an error if there is a mismatch.
func checkSessionAuthMethodLock(user *domain.User, session *domain.Session) error {
	if user.AuthMethodLock == nil {
		return nil
	}
	lock := *user.AuthMethodLock
	sessionIsSSO := session.SSOProviderName != nil

	if lock == "sso" && !sessionIsSSO {
		return fmt.Errorf("session does not match auth method lock")
	}
	if lock == "password" && sessionIsSSO {
		return fmt.Errorf("session does not match auth method lock")
	}
	return nil
}

// MigrateToSSO migrates a user to SSO-only authentication.
// It verifies the user has a linked SSO identity, clears the password hash,
// sets auth_method_lock to "sso", and revokes all sessions.
func (s *AuthService) MigrateToSSO(ctx context.Context, userID uuid.UUID) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	// Verify user has at least one SSO identity
	if s.ssoIdentityRepo == nil {
		return nil, fmt.Errorf("SSO identity repository not configured")
	}
	identities, err := s.ssoIdentityRepo.ListByUser(ctx, userID)
	if err != nil || len(identities) == 0 {
		return nil, fmt.Errorf("user has no linked SSO identity; link one before migrating")
	}

	// Clear password hash
	user.PasswordHash = nil

	// Set lock
	lock := "sso"
	user.AuthMethodLock = &lock

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	// Revoke all sessions — forces re-login via SSO
	_ = s.sessionRepo.RevokeAll(ctx, userID)

	slog.Info("user migrated to SSO-only auth",
		"user_id", userID, "email", user.Email,
		"sso_identities", len(identities))

	return user, nil
}

// MigrateToPassword migrates a user to password-only authentication.
// It validates and hashes the new password, sets auth_method_lock to "password",
// updates password_changed_at, and revokes all sessions.
func (s *AuthService) MigrateToPassword(ctx context.Context, userID uuid.UUID, newPassword string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	// Validate password against policy
	if err := auth.ValidatePassword(newPassword, s.cfg.PasswordPolicy()); err != nil {
		return nil, err
	}

	// Hash and set password
	hash, err := auth.HashPassword(newPassword, s.cfg.PasswordPolicy())
	if err != nil {
		return nil, err
	}

	now := time.Now()
	user.PasswordHash = &hash
	user.PasswordChangedAt = &now

	// Set lock
	lock := "password"
	user.AuthMethodLock = &lock

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	// Revoke all sessions — forces re-login via password
	_ = s.sessionRepo.RevokeAll(ctx, userID)

	slog.Info("user migrated to password-only auth",
		"user_id", userID, "email", user.Email)

	return user, nil
}

// SetAuthMethodLock sets or clears the auth method lock for a user.
// Valid values are nil (any method), "sso", or "password".
// Validates that the user has the required credentials for the chosen lock
// to prevent unrecoverable lockout.
func (s *AuthService) SetAuthMethodLock(ctx context.Context, userID uuid.UUID, lock *string) (*domain.User, error) {
	if lock != nil && *lock != "sso" && *lock != "password" {
		return nil, fmt.Errorf("invalid auth_method_lock value: must be null, \"sso\", or \"password\"")
	}

	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	// Validate the user can actually authenticate with the chosen method
	if lock != nil {
		switch *lock {
		case "sso":
			if s.ssoIdentityRepo == nil {
				return nil, fmt.Errorf("cannot lock to SSO: SSO identity repository not configured")
			}
			identities, err := s.ssoIdentityRepo.ListByUser(ctx, userID)
			if err != nil || len(identities) == 0 {
				return nil, fmt.Errorf("cannot lock to SSO: user has no linked SSO identity")
			}
		case "password":
			if user.PasswordHash == nil {
				return nil, fmt.Errorf("cannot lock to password: user has no password set")
			}
		}
	}

	user.AuthMethodLock = lock

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	slog.Info("auth method lock changed",
		"user_id", userID, "email", user.Email, "lock", lock)

	return user, nil
}
