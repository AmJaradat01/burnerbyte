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
		case *int64:
			*d = v.(int64)
		case *float32:
			*d = v.(float32)
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
		case **int:
			if v == nil {
				*d = nil
			} else if ip, ok := v.(*int); ok {
				*d = ip
			} else {
				n := v.(int)
				*d = &n
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
	// committed is set true when a transaction begun from this mock is committed.
	committed bool
}

// Begin lets mockDBTX stand in for the auth service's dbPool. The returned tx
// reuses this mock for data ops, so configured handlers apply inside the
// transaction too.
func (m *mockDBTX) Begin(context.Context) (pgx.Tx, error) { return &mockTx{mockDBTX: m}, nil }

// mockTx adapts mockDBTX to pgx.Tx so transactional service methods (Register,
// ResetPassword, …) run against the mock. Data ops use the embedded mock,
// Commit is recorded, and the rest of pgx.Tx is unused by the code under test.
type mockTx struct {
	*mockDBTX
}

func (m *mockTx) Begin(context.Context) (pgx.Tx, error) { return m, nil }
func (m *mockTx) Commit(context.Context) error          { m.mockDBTX.committed = true; return nil }
func (m *mockTx) Rollback(context.Context) error        { return nil }
func (m *mockTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (m *mockTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (m *mockTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (m *mockTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (m *mockTx) Conn() *pgx.Conn { return nil }

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
						identityID,  // id
						userID,      // user_id
						provider,    // provider
						subject,     // subject
						email,       // email
						displayName, // display_name
						any(nil),    // metadata
						now,         // linked_at
						now,         // last_used_at
					}}

				case strings.Contains(sql, "FROM users"):
					// GetByID → return user with EmailVerified=false
					// Use typed nil pointers for nullable fields
					var nilStr *string
					var nilTime *time.Time
					var nilInt *int
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
						nilInt,      // max_sessions
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
			nil, // revocationCache
			nil, // pendingLoginStore
			nil, // ssoCodeStore
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
					var nilInt *int
					return &mockRow{values: []any{
						userID,
						email,
						displayName,
						nilStr,  // avatar_url
						nilStr,  // password_hash
						nilStr,  // sso_provider
						nilStr,  // sso_subject
						false,   // is_system_admin
						true,    // email_verified — ALREADY TRUE
						nilTime, // password_changed_at
						nilStr,  // timezone
						nilStr,  // date_format
						nilStr,  // time_format
						nilStr,  // auth_method_lock
						nilInt,  // max_sessions
						now,     // created_at
						now,     // updated_at
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
			tokens, nil, nil, cfg, nil, nil, nil,
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
			tokens, nil, nil, cfg, nil, nil, nil,
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
					var nilInt *int
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
						nilInt,  // max_sessions
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
			tokens, nil, nil, cfg, nil, nil, nil,
		)

		callbackResult := &domain.SSOCallbackResult{
			Email:         email,
			EmailVerified: true, // verified provider email — required to auto-link to an existing account
			DisplayName:   displayName,
			Provider:      provider,
			Subject:       subject,
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

// Security regression: SSO account-takeover via unverified email.
//
// When no SSO identity exists but the email matches an existing (password)
// account, SSOLogin must refuse to auto-link unless the provider asserted the
// email is verified (result.EmailVerified). Otherwise a provider that returns
// an attacker-controlled, unverified email for a victim's address could take
// over the victim's account. This asserts the unverified case is rejected and
// the existing account is left untouched (no userRepo.Update).
func TestProperty_Security_UnverifiedEmailNoAutoLink(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		provider := rapid.StringMatching(`[a-z]{3,12}`).Draw(rt, "provider")
		subject := rapid.StringMatching(`[a-zA-Z0-9]{8,32}`).Draw(rt, "subject")
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")
		displayName := rapid.StringMatching(`[A-Z][a-z]{2,8} [A-Z][a-z]{2,8}`).Draw(rt, "displayName")

		userID := uuid.New()
		now := time.Now()

		updateCalled := false

		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				switch {
				case strings.Contains(sql, "sso_providers"):
					return &mockRow{err: pgx.ErrNoRows}
				case strings.Contains(sql, "user_sso_identities"):
					return &mockRow{err: pgx.ErrNoRows} // no identity
				case strings.Contains(sql, "FROM users"):
					// Existing account matched by email (a password account).
					var nilStr *string
					var nilTime *time.Time
					var nilInt *int
					return &mockRow{values: []any{
						userID, email, displayName,
						nilStr,  // avatar_url
						nilStr,  // password_hash
						nilStr,  // sso_provider
						nilStr,  // sso_subject
						false,   // is_system_admin
						false,   // email_verified
						nilTime, // password_changed_at
						nilStr,  // timezone
						nilStr,  // date_format
						nilStr,  // time_format
						nilStr,  // auth_method_lock
						nilInt,  // max_sessions
						now, now,
					}}
				default:
					return &mockRow{err: pgx.ErrNoRows}
				}
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				if strings.Contains(sql, "UPDATE users") {
					updateCalled = true
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
			tokens, nil, nil, cfg, nil, nil, nil,
		)

		// Unverified provider email for an address that already has an account.
		callbackResult := &domain.SSOCallbackResult{
			Email:         email,
			EmailVerified: false,
			DisplayName:   displayName,
			Provider:      provider,
			Subject:       subject,
		}

		user, tokenPair, err := svc.SSOLogin(context.Background(), callbackResult, "127.0.0.1", "test-agent")

		// SECURITY: must be rejected — no login, no tokens, no account mutation.
		if err == nil {
			rt.Fatalf("SECURITY VIOLATION: unverified SSO email auto-linked to existing account "+
				"(provider=%q, subject=%q, email=%q)", provider, subject, email)
		}
		if user != nil || tokenPair != nil {
			rt.Fatalf("SECURITY VIOLATION: SSOLogin returned a session for an unverified email "+
				"(user=%v, tokenPair=%v)", user != nil, tokenPair != nil)
		}
		if updateCalled {
			rt.Fatalf("SECURITY VIOLATION: existing account was modified during a rejected unverified-email SSO login "+
				"(provider=%q, email=%q)", provider, email)
		}
	})
}

// NOTE: Password registration preservation (Requirements 3.2) is not tested here
// because Register() requires a *pgxpool.Pool for transaction management, which
// cannot be mocked without additional infrastructure. The EmailVerified=false
// behavior is set directly in the Register function's user struct construction
// and is verified by inspection and integration tests.

// TestRegister_InviteOnly_RejectsInvalidToken guards the fix that, in
// invite-only mode, registration validates the invite TOKEN rather than merely
// finding any pending invite for the email. A garbage/unknown token must be
// rejected so an attacker can't pre-register (squat) an invited address. The
// rejection path returns before the DB transaction, so no pool is needed.
func TestRegister_InviteOnly_RejectsInvalidToken(t *testing.T) {
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			// GetInviteByToken finds no invite matching the presented token.
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	orgRepo := postgres.NewOrgRepo(db)
	cfg := &config.Config{} // Defaults.AllowRegistration defaults false => invite-only

	svc := NewAuthService(
		nil, nil, nil, nil, nil, orgRepo, nil, nil, nil, nil,
		nil, nil, nil, cfg, nil, nil, nil,
	)

	_, _, err := svc.Register(context.Background(), domain.CreateUserInput{
		Email:       "victim@corp.com",
		Password:    "Str0ng-Passw0rd!",
		DisplayName: "Victim",
		InviteToken: "garbage-not-a-real-token",
	})
	if err == nil {
		t.Fatal("invite-only registration with an invalid token must be rejected (squatting)")
	}
	if !strings.Contains(err.Error(), "valid invite") {
		t.Fatalf("expected a 'valid invite' rejection, got: %v", err)
	}
}

// TestRegister_OpenRegistration_Success exercises the full transactional happy
// path (previously untestable: Register opened a real *pgxpool.Pool tx). With
// the pool abstracted behind dbPool, the mock transaction runs the user insert,
// session creation, and commit.
func TestRegister_OpenRegistration_Success(t *testing.T) {
	db := &mockDBTX{
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("INSERT 1"), nil // user + session inserts succeed
		},
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			// The only QueryRow is the best-effort active-session count; erroring
			// it simply skips limit enforcement.
			return &mockRow{err: pgx.ErrNoRows}
		},
	}
	cfg := &config.Config{JWT: config.JWTConfig{
		Secret:     "test-secret-key-at-least-32-bytes-long!!",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 7 * 24 * time.Hour,
	}}
	cfg.Defaults.AllowRegistration = true // open registration: skip the invite gate
	tokens := auth.NewTokenManager(cfg.JWT)

	svc := NewAuthService(
		db, postgres.NewUserRepo(db), postgres.NewSessionRepo(db),
		nil, nil, nil, nil, nil, nil, nil,
		tokens, nil, nil, cfg, nil, nil, nil,
	)

	user, tp, err := svc.Register(context.Background(), domain.CreateUserInput{
		Email:       "New@Corp.com",
		Password:    "Str0ng-Passw0rd!",
		DisplayName: "New User",
	})
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if user == nil || user.Email != "new@corp.com" { // normalized to lowercase
		t.Fatalf("unexpected user: %+v", user)
	}
	if user.EmailVerified {
		t.Error("a freshly registered user must not be email-verified")
	}
	if tp == nil || tp.AccessToken == "" || tp.RefreshToken == "" {
		t.Fatal("expected a populated token pair")
	}
	if !db.committed {
		t.Error("the registration transaction should have been committed")
	}
}

// TestRegister_DuplicateEmail confirms a unique-violation on the user insert
// surfaces as a friendly "already registered" error (and not the raw DB error).
func TestRegister_DuplicateEmail(t *testing.T) {
	db := &mockDBTX{
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "INSERT INTO users") {
				return pgconn.CommandTag{}, &pgconn.PgError{Code: "23505"} // unique_violation
			}
			return pgconn.NewCommandTag("OK"), nil
		},
	}
	cfg := &config.Config{}
	cfg.Defaults.AllowRegistration = true

	svc := NewAuthService(
		db, postgres.NewUserRepo(db), postgres.NewSessionRepo(db),
		nil, nil, nil, nil, nil, nil, nil,
		nil, nil, nil, cfg, nil, nil, nil,
	)

	_, _, err := svc.Register(context.Background(), domain.CreateUserInput{
		Email:       "taken@corp.com",
		Password:    "Str0ng-Passw0rd!",
		DisplayName: "Taken",
	})
	if err == nil || !strings.Contains(err.Error(), "already registered") {
		t.Fatalf("expected an 'already registered' error, got: %v", err)
	}
	if db.committed {
		t.Error("a failed registration must not commit")
	}
}
