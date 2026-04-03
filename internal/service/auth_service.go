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
	pool            *pgxpool.Pool
	userRepo        *postgres.UserRepo
	sessionRepo     *postgres.SessionRepo
	resetRepo       *postgres.PasswordResetRepo
	emailVerifyRepo *postgres.EmailVerificationRepo
	orgRepo         *postgres.OrgRepo
	tokens          *auth.TokenManager
	lockout         *auth.Lockout
	mailer          *mailer.Mailer
	cfg             *config.Config
}

func NewAuthService(
	pool *pgxpool.Pool,
	userRepo *postgres.UserRepo,
	sessionRepo *postgres.SessionRepo,
	resetRepo *postgres.PasswordResetRepo,
	emailVerifyRepo *postgres.EmailVerificationRepo,
	orgRepo *postgres.OrgRepo,
	tokens *auth.TokenManager,
	lockout *auth.Lockout,
	mailer *mailer.Mailer,
	cfg *config.Config,
) *AuthService {
	return &AuthService{
		pool: pool, userRepo: userRepo, sessionRepo: sessionRepo,
		resetRepo: resetRepo, emailVerifyRepo: emailVerifyRepo, orgRepo: orgRepo,
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

	tokenPair, err = s.createSession(ctx, sessionRepoTx, user, "", "")
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
	var enforced bool
	_ = s.pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM organizations o JOIN org_memberships m ON m.org_id = o.id
			WHERE m.user_id = $1 AND (o.settings->>'enforce_sso')::boolean = true
		)`, user.ID).Scan(&enforced)
	if enforced {
		return nil, nil, fmt.Errorf("SSO login required for your organization")
	}

	tokenPair, err := s.createSession(ctx, s.sessionRepo, user, ip, userAgent)
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

func (s *AuthService) RevokeAllSessions(ctx context.Context, userID uuid.UUID) error {
	return s.sessionRepo.RevokeAll(ctx, userID)
}

func (s *AuthService) ForgotPassword(ctx context.Context, input domain.ForgotPasswordInput) error {
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

func (s *AuthService) ResetPassword(ctx context.Context, input domain.ResetPasswordInput) error {
	if input.Token == "" || input.NewPassword == "" {
		return fmt.Errorf("token and new_password are required")
	}

	if err := auth.ValidatePassword(input.NewPassword, s.cfg.Password); err != nil {
		return err
	}

	tokenHash := postgres.HashToken(input.Token)
	resetToken, err := s.resetRepo.Consume(ctx, tokenHash)
	if err != nil {
		return fmt.Errorf("invalid or expired reset token")
	}

	user, err := s.userRepo.GetByID(ctx, resetToken.UserID)
	if err != nil {
		return fmt.Errorf("user not found")
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
	// Revoke all sessions so stolen refresh tokens can't mint new access tokens
	return s.sessionRepo.RevokeAll(ctx, user.ID)
}

func (s *AuthService) SSOLogin(ctx context.Context, email, displayName, provider, subject, ip, userAgent string) (*domain.User, *domain.TokenPair, error) {
	ip = stripPort(ip)
	ssoCfg := s.cfg.SSO

	// Check allowed domains
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

	// Try to find existing SSO user
	isNew := false
	user, err := s.userRepo.GetBySSO(ctx, provider, subject)
	if err != nil {
		user, err = s.userRepo.GetByEmail(ctx, strings.ToLower(email))
		if err != nil {
			// New user — create with SSO identity
			user = &domain.User{
				ID: uuid.New(), Email: strings.ToLower(email), DisplayName: displayName,
				SSOProvider: &provider, SSOSubject: &subject,
				IsSystemAdmin: false, EmailVerified: true,
				PasswordChangedAt: func() *time.Time { t := time.Now(); return &t }(),
			}
			if err := s.userRepo.Create(ctx, user); err != nil {
				return nil, nil, fmt.Errorf("create SSO user: %w", err)
			}
			isNew = true
		} else {
			// Existing user found by email — only link SSO if they don't have a password
			// (prevents account takeover via SSO email claim)
			if user.PasswordHash != nil {
				return nil, nil, fmt.Errorf("an account with this email already exists — please sign in with your password first, then link SSO from your profile")
			}
			user.SSOProvider = &provider
			user.SSOSubject = &subject
			user.EmailVerified = true
			if err := s.userRepo.Update(ctx, user); err != nil {
				return nil, nil, fmt.Errorf("link SSO: %w", err)
			}
		}
	}

	// Auto-provision into org
	if isNew && ssoCfg.AutoProvision && s.orgRepo != nil {
		s.autoProvisionSSO(ctx, user, ssoCfg)
	}

	tokenPair, err := s.createSession(ctx, s.sessionRepo, user, ip, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tokenPair, nil
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

func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	tokenHash := postgres.HashToken(token)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	emailVerifyRepoTx := postgres.NewEmailVerificationRepo(tx)

	vt, err := emailVerifyRepoTx.Consume(ctx, tokenHash)
	if err != nil {
		return fmt.Errorf("invalid or expired verification link")
	}

	userRepoTx := s.userRepo.WithTx(tx)
	user, err := userRepoTx.GetByID(ctx, vt.UserID)
	if err != nil {
		return err
	}

	if !user.EmailVerified {
		user.EmailVerified = true
		if err := userRepoTx.Update(ctx, user); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	// Invalidate remaining tokens outside transaction (best-effort)
	_ = s.emailVerifyRepo.InvalidateForUser(ctx, vt.UserID)

	return nil
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

func (s *AuthService) createSession(ctx context.Context, repo *postgres.SessionRepo, user *domain.User, ip, userAgent string) (*domain.TokenPair, error) {
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

// LockedError indicates the account is locked.
type LockedError struct {
	RetryAfter time.Duration
}

func (e *LockedError) Error() string {
	return fmt.Sprintf("account locked, retry after %s", e.RetryAfter)
}
