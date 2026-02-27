package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/mailer"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
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
	pool        *pgxpool.Pool
	userRepo    *postgres.UserRepo
	sessionRepo *postgres.SessionRepo
	tokens      *auth.TokenManager
	lockout     *auth.Lockout
	mailer      *mailer.Mailer
	cfg         *config.Config
}

func NewAuthService(
	pool *pgxpool.Pool,
	userRepo *postgres.UserRepo,
	sessionRepo *postgres.SessionRepo,
	tokens *auth.TokenManager,
	lockout *auth.Lockout,
	mailer *mailer.Mailer,
	cfg *config.Config,
) *AuthService {
	return &AuthService{
		pool: pool, userRepo: userRepo, sessionRepo: sessionRepo,
		tokens: tokens, lockout: lockout, mailer: mailer, cfg: cfg,
	}
}

func (s *AuthService) Register(ctx context.Context, input domain.CreateUserInput) (*domain.User, *domain.TokenPair, error) {
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
			verifyURL := fmt.Sprintf("%s/verify-email/%s", s.cfg.Server.FrontendURL, user.ID)
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
	rawRefresh, refreshHash, _ := s.tokens.GenerateRefreshToken()
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
	return s.sessionRepo.Revoke(ctx, sessionID)
}

func (s *AuthService) RevokeAllSessions(ctx context.Context, userID uuid.UUID) error {
	return s.sessionRepo.RevokeAll(ctx, userID)
}

func (s *AuthService) ForgotPassword(ctx context.Context, input domain.ForgotPasswordInput) error {
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		// Don't reveal whether email exists
		return nil
	}

	// Generate a reset token (using user ID + timestamp hash for simplicity)
	resetToken := uuid.New().String()
	resetURL := fmt.Sprintf("%s/forgot-password?token=%s", s.cfg.Server.FrontendURL, resetToken)

	// In a production system, store the reset token with expiry in DB.
	// For now, log it (mailer will handle delivery or stdout fallback).
	slog.Info("password reset requested", "user_id", user.ID, "token", resetToken)

	go func() {
		_ = s.mailer.Send(user.Email, "Reset your password", "password_reset.html", map[string]string{
			"ResetURL": resetURL,
		})
	}()

	return nil
}

func (s *AuthService) VerifyEmail(ctx context.Context, userID uuid.UUID) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	user.EmailVerified = true
	return s.userRepo.Update(ctx, user)
}

func (s *AuthService) createSession(ctx context.Context, repo *postgres.SessionRepo, user *domain.User, ip, userAgent string) (*domain.TokenPair, error) {
	ip = stripPort(ip)
	accessToken, err := s.tokens.GenerateAccessToken(user.ID, user.Email, user.IsSystemAdmin)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, _ := s.tokens.GenerateRefreshToken()

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
