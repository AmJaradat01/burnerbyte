package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"pgregory.net/rapid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// ---------------------------------------------------------------------------
// Mock DBTX implementation for testing AuthService without a real database.
// ---------------------------------------------------------------------------

// mockRow implements pgx.Row for returning a single row of scan values.
type mockRow struct {
	values []any
	err    error
}

func (r *mockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return fmt.Errorf("mockRow: expected %d dest, got %d", len(r.values), len(dest))
	}
	for i, v := range r.values {
		switch d := dest[i].(type) {
		case *uuid.UUID:
			*d = v.(uuid.UUID)
		case *string:
			*d = v.(string)
		case **string:
			if v == nil {
				*d = nil
			} else if sp, ok := v.(*string); ok {
				*d = sp
			} else {
				s := v.(string)
				*d = &s
			}
		case *bool:
			*d = v.(bool)
		case *time.Time:
			*d = v.(time.Time)
		case **time.Time:
			if v == nil {
				*d = nil
			} else if tp, ok := v.(*time.Time); ok {
				*d = tp
			} else {
				t := v.(time.Time)
				*d = &t
			}
		case *any:
			*d = v
		default:
			return fmt.Errorf("mockRow: unsupported dest type %T at index %d", dest[i], i)
		}
	}
	return nil
}

// mockDBTX is a programmable mock for database.DBTX.
// It dispatches based on SQL query substrings.
type mockDBTX struct {
	// queryRowHandler is called for QueryRow calls.
	queryRowHandler func(sql string, args ...any) pgx.Row
	// execHandler is called for Exec calls.
	execHandler func(sql string, args ...any) (pgconn.CommandTag, error)
	// queryHandler is called for Query calls.
	queryHandler func(sql string, args ...any) (pgx.Rows, error)
}

func (m *mockDBTX) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if m.execHandler != nil {
		return m.execHandler(sql, args...)
	}
	return pgconn.NewCommandTag("OK"), nil
}

func (m *mockDBTX) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if m.queryHandler != nil {
		return m.queryHandler(sql, args...)
	}
	return nil, fmt.Errorf("mockDBTX: Query not configured")
}

func (m *mockDBTX) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if m.queryRowHandler != nil {
		return m.queryRowHandler(sql, args...)
	}
	return &mockRow{err: pgx.ErrNoRows}
}

// ---------------------------------------------------------------------------
// Bug Condition Exploration Test — Bug 2: SSO EmailVerified
// ---------------------------------------------------------------------------

// Feature: user-management-ux-fixes, Property 2: Bug Condition — SSO Identity Lookup Sets EmailVerified
// **Validates: Requirements 1.3, 2.3**
//
// For any SSO login where the user is resolved via the identity lookup path
// (ssoIdentityRepo.GetByProviderSubject succeeds) and the user's EmailVerified
// is false, the SSOLogin function SHALL set EmailVerified = true and persist
// the update via userRepo.Update before creating the session.
//
// On UNFIXED code this test is EXPECTED TO FAIL because the identity-lookup
// path does not update EmailVerified.
func TestProperty_BugCondition_SSOIdentityLookupSetsEmailVerified(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		// Generate random SSO callback data
		provider := rapid.StringMatching(`[a-z]{3,12}`).Draw(rt, "provider")
		subject := rapid.StringMatching(`[a-zA-Z0-9]{8,32}`).Draw(rt, "subject")
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")
		displayName := rapid.StringMatching(`[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}`).Draw(rt, "displayName")

		userID := uuid.New()
		identityID := uuid.New()
		now := time.Now()

		// Track whether userRepo.Update was called with EmailVerified=true
		updateCalled := false
		updatedEmailVerified := false

		// Build mock DBTX that simulates the identity-lookup path:
		// 1. ssoProviderRepo.GetByName → not found (no allowed domain restrictions)
		// 2. ssoIdentityRepo.GetByProviderSubject → returns identity
		// 3. ssoIdentityRepo.UpdateLastUsed → succeeds
		// 4. userRepo.GetByID → returns user with EmailVerified=false
		// 5. sessionRepo.Create → succeeds
		// 6. userRepo.Update → track the call
		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				switch {
				case strings.Contains(sql, "sso_providers"):
					// GetByName → not found (skip domain check)
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "user_sso_identities"):
					// GetByProviderSubject → return identity
					return &mockRow{values: []any{
						identityID,       // id
						userID,           // user_id
						provider,         // provider
						subject,          // subject
						email,            // email
						displayName,      // display_name
						any(nil),         // metadata
						now,              // linked_at
						now,              // last_used_at
					}}

				case strings.Contains(sql, "FROM users"):
					// GetByID → return user with EmailVerified=false
					// Use typed nil pointers for nullable fields
					var nilStr *string
					var nilTime *time.Time
					return &mockRow{values: []any{
						userID,      // id
						email,       // email
						displayName, // display_name
						nilStr,      // avatar_url
						nilStr,      // password_hash
						nilStr,      // sso_provider
						nilStr,      // sso_subject
						false,       // is_system_admin
						false,       // email_verified (THE BUG: this should become true)
						nilTime,     // password_changed_at
						nilStr,      // timezone
						nilStr,      // date_format
						nilStr,      // time_format
						nilStr,      // auth_method_lock
						now,         // created_at
						now,         // updated_at
					}}

				default:
					return &mockRow{err: pgx.ErrNoRows}
				}
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				if strings.Contains(sql, "UPDATE users") {
					updateCalled = true
					// Check if EmailVerified (arg index 7, 0-based) is true
					// UPDATE users SET email=$1, display_name=$2, avatar_url=$3, password_hash=$4,
					// sso_provider=$5, sso_subject=$6, is_system_admin=$7, email_verified=$8, ...
					if len(args) >= 8 {
						if ev, ok := args[7].(bool); ok {
							updatedEmailVerified = ev
						}
					}
				}
				return pgconn.NewCommandTag("UPDATE 1"), nil
			},
		}

		// Build repos from mock DBTX
		userRepo := postgres.NewUserRepo(db)
		sessionRepo := postgres.NewSessionRepo(db)
		ssoIdentityRepo := postgres.NewSSOIdentityRepo(db)
		ssoProviderRepo := postgres.NewSSOProviderRepo(db, nil)

		// Build minimal config and token manager
		cfg := &config.Config{
			JWT: config.JWTConfig{
				Secret:     "test-secret-key-at-least-32-bytes-long!!",
				AccessTTL:  15 * time.Minute,
				RefreshTTL: 7 * 24 * time.Hour,
			},
		}
		tokens := auth.NewTokenManager(cfg.JWT)

		svc := NewAuthService(
			nil, // pool (not needed — we don't use transactions in SSOLogin)
			userRepo,
			sessionRepo,
			nil, // resetRepo
			nil, // emailVerifyRepo
			nil, // orgRepo
			ssoIdentityRepo,
			ssoProviderRepo,
			nil, // teamRepo
			nil, // domainMappingRepo
			tokens,
			nil, // lockout
			nil, // mailer
			cfg,
		)

		// Execute SSOLogin
		callbackResult := &domain.SSOCallbackResult{
			Email:       email,
			DisplayName: displayName,
			Provider:    provider,
			Subject:     subject,
		}

		user, tokenPair, err := svc.SSOLogin(context.Background(), callbackResult, "127.0.0.1", "test-agent")
		if err != nil {
			rt.Fatalf("SSOLogin returned error: %v", err)
		}
		if tokenPair == nil {
			rt.Fatal("SSOLogin returned nil token pair")
		}

		// ASSERTION 1: user.EmailVerified must be true after SSO login
		// On unfixed code, this will be false because the identity-lookup path
		// does not set EmailVerified = true.
		if !user.EmailVerified {
			rt.Fatalf("BUG CONFIRMED: SSOLogin via identity lookup returned user with EmailVerified=false "+
				"(provider=%q, subject=%q). Expected EmailVerified=true because SSO authentication "+
				"through a trusted identity provider constitutes email verification.", provider, subject)
		}

		// ASSERTION 2: userRepo.Update must have been called with EmailVerified=true
		if !updateCalled || !updatedEmailVerified {
			rt.Fatalf("BUG CONFIRMED: userRepo.Update was not called with EmailVerified=true "+
				"(updateCalled=%v, updatedEmailVerified=%v, provider=%q, subject=%q)",
				updateCalled, updatedEmailVerified, provider, subject)
		}
	})
}

// ---------------------------------------------------------------------------
// Preservation Property Tests — Verify existing correct behavior on UNFIXED code
// ---------------------------------------------------------------------------

// Feature: user-management-ux-fixes, Property 4: Preservation — SSO Login Preserves Non-Identity-Lookup Paths
// **Validates: Requirements 3.3, 3.4**
//
// Already-verified identity-lookup preservation:
// For any SSO login where the user is resolved via the identity lookup path
// (ssoIdentityRepo.GetByProviderSubject succeeds) and the user already has
// EmailVerified=true, assert EmailVerified remains true after SSOLogin.
// This captures existing correct behavior that must be preserved.
func TestProperty_Preservation_AlreadyVerifiedIdentityLookup(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		// Generate random SSO callback data
		provider := rapid.StringMatching(`[a-z]{3,12}`).Draw(rt, "provider")
		subject := rapid.StringMatching(`[a-zA-Z0-9]{8,32}`).Draw(rt, "subject")
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")
		displayName := rapid.StringMatching(`[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}`).Draw(rt, "displayName")

		userID := uuid.New()
		identityID := uuid.New()
		now := time.Now()

		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				switch {
				case strings.Contains(sql, "sso_providers"):
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "user_sso_identities"):
					return &mockRow{values: []any{
						identityID,
						userID,
						provider,
						subject,
						email,
						displayName,
						any(nil),
						now,
						now,
					}}

				case strings.Contains(sql, "FROM users"):
					var nilStr *string
					var nilTime *time.Time
					return &mockRow{values: []any{
						userID,
						email,
						displayName,
						nilStr,      // avatar_url
						nilStr,      // password_hash
						nilStr,      // sso_provider
						nilStr,      // sso_subject
						false,       // is_system_admin
						true,        // email_verified — ALREADY TRUE
						nilTime,     // password_changed_at
						nilStr,      // timezone
						nilStr,      // date_format
						nilStr,      // time_format
						nilStr,      // auth_method_lock
						now,         // created_at
						now,         // updated_at
					}}

				default:
					return &mockRow{err: pgx.ErrNoRows}
				}
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				return pgconn.NewCommandTag("UPDATE 1"), nil
			},
		}

		userRepo := postgres.NewUserRepo(db)
		sessionRepo := postgres.NewSessionRepo(db)
		ssoIdentityRepo := postgres.NewSSOIdentityRepo(db)
		ssoProviderRepo := postgres.NewSSOProviderRepo(db, nil)

		cfg := &config.Config{
			JWT: config.JWTConfig{
				Secret:     "test-secret-key-at-least-32-bytes-long!!",
				AccessTTL:  15 * time.Minute,
				RefreshTTL: 7 * 24 * time.Hour,
			},
		}
		tokens := auth.NewTokenManager(cfg.JWT)

		svc := NewAuthService(
			nil, userRepo, sessionRepo, nil, nil, nil,
			ssoIdentityRepo, ssoProviderRepo, nil, nil,
			tokens, nil, nil, cfg,
		)

		callbackResult := &domain.SSOCallbackResult{
			Email:       email,
			DisplayName: displayName,
			Provider:    provider,
			Subject:     subject,
		}

		user, tokenPair, err := svc.SSOLogin(context.Background(), callbackResult, "127.0.0.1", "test-agent")
		if err != nil {
			rt.Fatalf("SSOLogin returned error: %v", err)
		}
		if tokenPair == nil {
			rt.Fatal("SSOLogin returned nil token pair")
		}

		// PRESERVATION: EmailVerified must remain true
		if !user.EmailVerified {
			rt.Fatalf("PRESERVATION VIOLATED: SSOLogin via identity lookup changed EmailVerified from true to false "+
				"(provider=%q, subject=%q)", provider, subject)
		}
	})
}

// Feature: user-management-ux-fixes, Property 4: Preservation — SSO Login Preserves Non-Identity-Lookup Paths
// **Validates: Requirements 3.3**
//
// New SSO user preservation:
// For any SSO login where no identity exists AND no email match exists,
// assert user is created with EmailVerified=true.
// Mock GetByProviderSubject to return pgx.ErrNoRows, mock GetByEmail to return
// pgx.ErrNoRows, and mock Create to succeed.
func TestProperty_Preservation_NewSSOUser(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		provider := rapid.StringMatching(`[a-z]{3,12}`).Draw(rt, "provider")
		subject := rapid.StringMatching(`[a-zA-Z0-9]{8,32}`).Draw(rt, "subject")
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")
		displayName := rapid.StringMatching(`[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}`).Draw(rt, "displayName")

		// Track what was passed to userRepo.Create
		var createdEmailVerified bool
		createCalled := false

		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				switch {
				case strings.Contains(sql, "sso_providers"):
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "user_sso_identities"):
					// No identity found
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "FROM users"):
					// No user found by email
					return &mockRow{err: pgx.ErrNoRows}

				default:
					return &mockRow{err: pgx.ErrNoRows}
				}
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				if strings.Contains(sql, "INSERT INTO users") {
					createCalled = true
					// email_verified is at arg index 8 (0-based) in the INSERT
					if len(args) >= 9 {
						if ev, ok := args[8].(bool); ok {
							createdEmailVerified = ev
						}
					}
				}
				return pgconn.NewCommandTag("INSERT 1"), nil
			},
		}

		userRepo := postgres.NewUserRepo(db)
		sessionRepo := postgres.NewSessionRepo(db)
		ssoIdentityRepo := postgres.NewSSOIdentityRepo(db)
		ssoProviderRepo := postgres.NewSSOProviderRepo(db, nil)

		cfg := &config.Config{
			JWT: config.JWTConfig{
				Secret:     "test-secret-key-at-least-32-bytes-long!!",
				AccessTTL:  15 * time.Minute,
				RefreshTTL: 7 * 24 * time.Hour,
			},
			Defaults: config.DefaultsConfig{
				AllowRegistration: true, // open registration for this preservation test
			},
		}
		tokens := auth.NewTokenManager(cfg.JWT)

		svc := NewAuthService(
			nil, userRepo, sessionRepo, nil, nil, nil,
			ssoIdentityRepo, ssoProviderRepo, nil, nil,
			tokens, nil, nil, cfg,
		)

		callbackResult := &domain.SSOCallbackResult{
			Email:       email,
			DisplayName: displayName,
			Provider:    provider,
			Subject:     subject,
		}

		user, tokenPair, err := svc.SSOLogin(context.Background(), callbackResult, "127.0.0.1", "test-agent")
		if err != nil {
			rt.Fatalf("SSOLogin returned error: %v", err)
		}
		if tokenPair == nil {
			rt.Fatal("SSOLogin returned nil token pair")
		}

		// PRESERVATION: New SSO user must be created with EmailVerified=true
		if !createCalled {
			rt.Fatal("PRESERVATION VIOLATED: userRepo.Create was not called for new SSO user")
		}
		if !createdEmailVerified {
			rt.Fatalf("PRESERVATION VIOLATED: New SSO user created with EmailVerified=false "+
				"(provider=%q, subject=%q, email=%q)", provider, subject, email)
		}
		if !user.EmailVerified {
			rt.Fatalf("PRESERVATION VIOLATED: SSOLogin returned user with EmailVerified=false for new SSO user "+
				"(provider=%q, subject=%q, email=%q)", provider, subject, email)
		}
	})
}

// Feature: user-management-ux-fixes, Property 4: Preservation — SSO Login Preserves Non-Identity-Lookup Paths
// **Validates: Requirements 3.4**
//
// Email-lookup SSO preservation:
// For any SSO login where no identity exists but email matches an existing user,
// assert EmailVerified=true after SSOLogin.
// Mock GetByProviderSubject to return pgx.ErrNoRows, mock GetByEmail to return
// a user, and verify EmailVerified is set to true and userRepo.Update is called.
func TestProperty_Preservation_EmailLookupSSO(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		provider := rapid.StringMatching(`[a-z]{3,12}`).Draw(rt, "provider")
		subject := rapid.StringMatching(`[a-zA-Z0-9]{8,32}`).Draw(rt, "subject")
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")
		displayName := rapid.StringMatching(`[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}`).Draw(rt, "displayName")

		userID := uuid.New()
		now := time.Now()

		updateCalled := false
		updatedEmailVerified := false

		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				switch {
				case strings.Contains(sql, "sso_providers"):
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "user_sso_identities"):
					// No identity found
					return &mockRow{err: pgx.ErrNoRows}

				case strings.Contains(sql, "FROM users"):
					// User found by email with EmailVerified=false
					var nilStr *string
					var nilTime *time.Time
					return &mockRow{values: []any{
						userID,
						email,
						displayName,
						nilStr,  // avatar_url
						nilStr,  // password_hash
						nilStr,  // sso_provider
						nilStr,  // sso_subject
						false,   // is_system_admin
						false,   // email_verified — starts false
						nilTime, // password_changed_at
						nilStr,  // timezone
						nilStr,  // date_format
						nilStr,  // time_format
						nilStr,  // auth_method_lock
						now,     // created_at
						now,     // updated_at
					}}

				default:
					return &mockRow{err: pgx.ErrNoRows}
				}
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				if strings.Contains(sql, "UPDATE users") {
					updateCalled = true
					if len(args) >= 8 {
						if ev, ok := args[7].(bool); ok {
							updatedEmailVerified = ev
						}
					}
				}
				return pgconn.NewCommandTag("UPDATE 1"), nil
			},
		}

		userRepo := postgres.NewUserRepo(db)
		sessionRepo := postgres.NewSessionRepo(db)
		ssoIdentityRepo := postgres.NewSSOIdentityRepo(db)
		ssoProviderRepo := postgres.NewSSOProviderRepo(db, nil)

		cfg := &config.Config{
			JWT: config.JWTConfig{
				Secret:     "test-secret-key-at-least-32-bytes-long!!",
				AccessTTL:  15 * time.Minute,
				RefreshTTL: 7 * 24 * time.Hour,
			},
		}
		tokens := auth.NewTokenManager(cfg.JWT)

		svc := NewAuthService(
			nil, userRepo, sessionRepo, nil, nil, nil,
			ssoIdentityRepo, ssoProviderRepo, nil, nil,
			tokens, nil, nil, cfg,
		)

		callbackResult := &domain.SSOCallbackResult{
			Email:       email,
			DisplayName: displayName,
			Provider:    provider,
			Subject:     subject,
		}

		user, tokenPair, err := svc.SSOLogin(context.Background(), callbackResult, "127.0.0.1", "test-agent")
		if err != nil {
			rt.Fatalf("SSOLogin returned error: %v", err)
		}
		if tokenPair == nil {
			rt.Fatal("SSOLogin returned nil token pair")
		}

		// PRESERVATION: Email-lookup path must set EmailVerified=true
		if !user.EmailVerified {
			rt.Fatalf("PRESERVATION VIOLATED: SSOLogin via email lookup returned user with EmailVerified=false "+
				"(provider=%q, subject=%q, email=%q)", provider, subject, email)
		}
		if !updateCalled || !updatedEmailVerified {
			rt.Fatalf("PRESERVATION VIOLATED: userRepo.Update not called with EmailVerified=true for email-lookup path "+
				"(updateCalled=%v, updatedEmailVerified=%v, provider=%q, subject=%q)",
				updateCalled, updatedEmailVerified, provider, subject)
		}
	})
}

// NOTE: Password registration preservation (Requirements 3.2) is not tested here
// because Register() requires a *pgxpool.Pool for transaction management, which
// cannot be mocked without additional infrastructure. The EmailVerified=false
// behavior is set directly in the Register function's user struct construction
// and is verified by inspection and integration tests.
