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
		case *int:
			*d = v.(int)
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
		case **uuid.UUID:
			if v == nil {
				*d = nil
			} else if up, ok := v.(*uuid.UUID); ok {
				*d = up
			} else {
				u := v.(uuid.UUID)
				*d = &u
			}
		case *[]byte:
			if v == nil {
				*d = nil
			} else {
				*d = v.([]byte)
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

// TestLogin_UnknownEmail_GenericError locks in the account-enumeration defense:
// an unknown email returns the same generic "invalid email or password" as a
// wrong password (after a dummy bcrypt comparison to equalize timing), never
// revealing whether the address exists.
func TestLogin_UnknownEmail_GenericError(t *testing.T) {
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			return &mockRow{err: pgx.ErrNoRows} // GetByEmail -> not found
		},
	}
	cfg := &config.Config{}
	svc := NewAuthService(
		db, postgres.NewUserRepo(db), postgres.NewSessionRepo(db),
		nil, nil, nil, nil, nil, nil, nil,
		nil, nil, nil, cfg, nil, nil, nil,
	)

	_, _, err := svc.Login(context.Background(),
		domain.LoginInput{Email: "ghost@corp.com", Password: "whatever"}, "1.2.3.4", "agent")
	if err == nil || !strings.Contains(err.Error(), "invalid email or password") {
		t.Fatalf("expected the generic 'invalid email or password', got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Logout — cookie-mode sign-out revokes the whole token family
// ---------------------------------------------------------------------------

func newLogoutTestService(db *mockDBTX) *AuthService {
	return NewAuthService(
		nil, // pool
		nil, // userRepo
		postgres.NewSessionRepo(db),
		nil, // resetRepo
		nil, // emailVerifyRepo
		nil, // orgRepo
		nil, // ssoIdentityRepo
		nil, // ssoProviderRepo
		nil, // teamRepo
		nil, // domainMappingRepo
		nil, // tokens
		nil, // lockout
		nil, // mailer
		&config.Config{},
		nil, // revocationCache
		nil, // pendingLoginStore
		nil, // ssoCodeStore
	)
}

func logoutSessionRow(sessionID, userID, family uuid.UUID, revoked bool) *mockRow {
	now := time.Now()
	return &mockRow{values: []any{
		sessionID,          // id
		userID,             // user_id
		"hash",             // refresh_token_hash
		family,             // token_family
		nil,                // ip_address
		nil,                // user_agent
		now,                // last_used_at
		now.Add(time.Hour), // expires_at
		revoked,            // revoked
		now,                // created_at
		nil,                // sso_provider_name
	}}
}

// TestLogout_RevokesTokenFamily verifies that logging out kills the session's
// entire token family — the full rotation chain for that device — not just the
// single current session row.
func TestLogout_RevokesTokenFamily(t *testing.T) {
	sessionID, userID, family := uuid.New(), uuid.New(), uuid.New()
	var revokedFamily uuid.UUID
	revokeCalls := 0

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM sessions") {
				return logoutSessionRow(sessionID, userID, family, false)
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "token_family") {
				revokeCalls++
				if fam, ok := args[0].(uuid.UUID); ok {
					revokedFamily = fam
				}
			}
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
	}

	session, err := newLogoutTestService(db).Logout(context.Background(), "raw-refresh-token")
	if err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if session == nil || session.UserID != userID {
		t.Fatalf("expected the revoked session back for auditing, got %+v", session)
	}
	if revokeCalls != 1 || revokedFamily != family {
		t.Errorf("expected exactly one family revocation for %s, got %d calls (family %s)", family, revokeCalls, revokedFamily)
	}
}

// TestLogout_UnknownTokenIsNoop verifies logout is idempotent and silent for
// unknown tokens: no error, no session, no writes — nothing an attacker could
// use as a token-validity oracle.
func TestLogout_UnknownTokenIsNoop(t *testing.T) {
	execCalls := 0
	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			return &mockRow{err: pgx.ErrNoRows}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			execCalls++
			return pgconn.NewCommandTag("UPDATE 0"), nil
		},
	}

	session, err := newLogoutTestService(db).Logout(context.Background(), "no-such-token")
	if err != nil || session != nil {
		t.Fatalf("unknown token must be a silent no-op, got session=%+v err=%v", session, err)
	}
	if execCalls != 0 {
		t.Errorf("unknown token must not write anything, got %d exec calls", execCalls)
	}
}

// TestLogout_RevokedSessionStillRevokesFamily: a token that was already
// rotated away (its row is revoked) still identifies the device's family, and
// signing out must kill the live tail of that chain.
func TestLogout_RevokedSessionStillRevokesFamily(t *testing.T) {
	family := uuid.New()
	revokeCalls := 0

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM sessions") {
				return logoutSessionRow(uuid.New(), uuid.New(), family, true)
			}
			return &mockRow{err: pgx.ErrNoRows}
		},
		execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "token_family") {
				revokeCalls++
			}
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
	}

	if _, err := newLogoutTestService(db).Logout(context.Background(), "stale-rotated-token"); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if revokeCalls != 1 {
		t.Errorf("expected the family revocation even for an already-revoked row, got %d calls", revokeCalls)
	}
}

// ===========================================================================
// Feature: auth-lifecycle-management — Auth method lock, session binding,
// and admin-driven migration property tests.
// ===========================================================================

// ---------------------------------------------------------------------------
// Multi-row mock for Query (the single-row mockRow above only covers QueryRow).
// ---------------------------------------------------------------------------

// mockRows adapts a slice of pre-built value rows to pgx.Rows, reusing
// mockRow.Scan for the per-row decoding so the supported dest types stay in
// one place.
type mockRows struct {
	rows [][]any
	idx  int
	err  error
}

func (m *mockRows) Close()                                       {}
func (m *mockRows) Err() error                                   { return m.err }
func (m *mockRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (m *mockRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (m *mockRows) RawValues() [][]byte                          { return nil }
func (m *mockRows) Conn() *pgx.Conn                              { return nil }

func (m *mockRows) Next() bool {
	if m.idx >= len(m.rows) {
		return false
	}
	m.idx++
	return true
}

func (m *mockRows) Scan(dest ...any) error {
	return (&mockRow{values: m.rows[m.idx-1]}).Scan(dest...)
}

func (m *mockRows) Values() ([]any, error) { return m.rows[m.idx-1], nil }

// userScanRow builds a mockRow matching UserRepo.scanOne's 17-column SELECT
// (GetByID / GetByEmail) with the given identity-relevant fields and inert
// defaults for the rest.
func userScanRow(id uuid.UUID, email string, passwordHash, lock *string) *mockRow {
	now := time.Now()
	var nilStr *string
	var nilTime *time.Time
	var nilInt *int
	return &mockRow{values: []any{
		id,           // id
		email,        // email
		"Test User",  // display_name
		nilStr,       // avatar_url
		passwordHash, // password_hash
		nilStr,       // sso_provider
		nilStr,       // sso_subject
		false,        // is_system_admin
		true,         // email_verified
		nilTime,      // password_changed_at
		nilStr,       // timezone
		nilStr,       // date_format
		nilStr,       // time_format
		lock,         // auth_method_lock
		nilInt,       // max_sessions
		now,          // created_at
		now,          // updated_at
	}}
}

// ssoIdentityRows builds mock Query rows matching SSOIdentityRepo.ListByUser's
// 9-column SELECT, with n identities linked to userID.
func ssoIdentityRows(userID uuid.UUID, n int) *mockRows {
	now := time.Now()
	rows := make([][]any, 0, n)
	for i := 0; i < n; i++ {
		rows = append(rows, []any{
			uuid.New(),   // id
			userID,       // user_id
			"okta",       // provider
			"subject",    // subject
			"u@corp.com", // email
			"User",       // display_name
			any(nil),     // metadata
			now,          // linked_at
			now,          // last_used_at
		})
	}
	return &mockRows{rows: rows}
}

// lockPtr returns a pointer to the lock value, or nil for the "any" choice.
func lockPtr(choice string) *string {
	if choice == "" {
		return nil
	}
	return &choice
}

// Property 1: Lock enforcement is total.
//
// For any user U and attempted method m ∈ {"password","sso"}:
//   - U.AuthMethodLock == nil  → checkAuthMethodLock succeeds for either method
//   - U.AuthMethodLock == "sso" → succeeds iff m == "sso"
//   - U.AuthMethodLock == "password" → succeeds iff m == "password"
//
// Validates: Requirements 1.1, 1.2, 1.3
func TestProperty_AuthMethodLock_Enforcement(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		lock := rapid.SampledFrom([]string{"", "sso", "password"}).Draw(rt, "lock")
		method := rapid.SampledFrom([]string{"sso", "password"}).Draw(rt, "method")

		user := &domain.User{AuthMethodLock: lockPtr(lock)}
		err := checkAuthMethodLock(user, method)

		shouldPass := lock == "" || lock == method
		if shouldPass && err != nil {
			rt.Fatalf("lock=%q method=%q: expected login to be allowed, got error: %v", lock, method, err)
		}
		if !shouldPass && err == nil {
			rt.Fatalf("lock=%q method=%q: expected login to be rejected, got nil error", lock, method)
		}
	})
}

// Property 2: Session binding is consistent.
//
// For any user U and session S, with sessionIsSSO := (S.SSOProviderName != nil):
//   - U.AuthMethodLock == nil  → refresh always allowed
//   - U.AuthMethodLock == "sso" → allowed iff sessionIsSSO
//   - U.AuthMethodLock == "password" → allowed iff !sessionIsSSO
//
// Validates: Requirements 3.1, 3.2, 3.3
func TestProperty_SessionAuthMethodLock_Binding(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		lock := rapid.SampledFrom([]string{"", "sso", "password"}).Draw(rt, "lock")
		sessionIsSSO := rapid.Bool().Draw(rt, "sessionIsSSO")

		user := &domain.User{AuthMethodLock: lockPtr(lock)}
		session := &domain.Session{}
		if sessionIsSSO {
			p := "okta"
			session.SSOProviderName = &p
		}

		err := checkSessionAuthMethodLock(user, session)

		shouldPass := lock == "" ||
			(lock == "sso" && sessionIsSSO) ||
			(lock == "password" && !sessionIsSSO)
		if shouldPass && err != nil {
			rt.Fatalf("lock=%q sessionIsSSO=%v: expected refresh to be allowed, got error: %v", lock, sessionIsSSO, err)
		}
		if !shouldPass && err == nil {
			rt.Fatalf("lock=%q sessionIsSSO=%v: expected refresh to be rejected, got nil error", lock, sessionIsSSO)
		}
	})
}

// newMigrationTestService wires an AuthService backed by the given mock DBTX
// with the repos the migration paths touch (user, session, sso identity).
func newMigrationTestService(db *mockDBTX, cfg *config.Config) *AuthService {
	return NewAuthService(
		nil,                             // pool
		postgres.NewUserRepo(db),        // userRepo
		postgres.NewSessionRepo(db),     // sessionRepo
		nil,                             // resetRepo
		nil,                             // emailVerifyRepo
		nil,                             // orgRepo
		postgres.NewSSOIdentityRepo(db), // ssoIdentityRepo
		nil,                             // ssoProviderRepo
		nil,                             // teamRepo
		nil,                             // domainMappingRepo
		nil,                             // tokens
		nil,                             // lockout
		nil,                             // mailer
		cfg,
		nil, // revocationCache
		nil, // pendingLoginStore
		nil, // ssoCodeStore
	)
}

// Property 3: Migration atomicity.
//
// After MigrateToSSO (user has a linked identity): password_hash = nil,
// auth_method_lock = "sso", all sessions revoked. After MigrateToPassword
// (valid password): password_hash != nil, auth_method_lock = "password",
// all sessions revoked.
//
// Validates: Requirements 2.1, 2.3
func TestProperty_Migration_Atomicity(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		target := rapid.SampledFrom([]string{"sso", "password"}).Draw(rt, "target")
		userID := uuid.New()
		email := rapid.StringMatching(`[a-z]{3,8}@[a-z]{3,8}\.[a-z]{2,4}`).Draw(rt, "email")

		updateCalled := false
		revokeAllCalled := false
		var updatedHash *string
		var updatedLock *string

		oldHash := "old-bcrypt-hash"
		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				if strings.Contains(sql, "FROM users") {
					return userScanRow(userID, email, &oldHash, nil)
				}
				return &mockRow{err: pgx.ErrNoRows}
			},
			queryHandler: func(sql string, args ...any) (pgx.Rows, error) {
				if strings.Contains(sql, "user_sso_identities") {
					return ssoIdentityRows(userID, 1), nil // one linked identity
				}
				return &mockRows{}, nil
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				switch {
				case strings.Contains(sql, "UPDATE users"):
					updateCalled = true
					if hp, ok := args[3].(*string); ok { // password_hash = $4
						updatedHash = hp
					}
					if lk, ok := args[12].(*string); ok { // auth_method_lock = $13
						updatedLock = lk
					}
				case strings.Contains(sql, "UPDATE sessions"):
					revokeAllCalled = true
				}
				return pgconn.NewCommandTag("OK"), nil
			},
		}

		cfg := &config.Config{}
		cfg.Password.BcryptCost = 4 // fast hashing under rapid

		svc := newMigrationTestService(db, cfg)

		var user *domain.User
		var err error
		if target == "sso" {
			user, err = svc.MigrateToSSO(context.Background(), userID)
		} else {
			user, err = svc.MigrateToPassword(context.Background(), userID, "Str0ng-Passw0rd!")
		}
		if err != nil {
			rt.Fatalf("target=%q: migration failed: %v", target, err)
		}

		if !updateCalled {
			rt.Fatalf("target=%q: expected userRepo.Update to be called", target)
		}
		if !revokeAllCalled {
			rt.Fatalf("target=%q: expected all sessions to be revoked", target)
		}

		switch target {
		case "sso":
			if user.PasswordHash != nil {
				rt.Fatalf("MigrateToSSO: expected returned password_hash=nil, got %v", *user.PasswordHash)
			}
			if updatedHash != nil {
				rt.Fatalf("MigrateToSSO: expected persisted password_hash=nil, got %v", *updatedHash)
			}
			if user.AuthMethodLock == nil || *user.AuthMethodLock != "sso" {
				rt.Fatalf("MigrateToSSO: expected lock=sso, got %v", user.AuthMethodLock)
			}
			if updatedLock == nil || *updatedLock != "sso" {
				rt.Fatalf("MigrateToSSO: expected persisted lock=sso, got %v", updatedLock)
			}
		case "password":
			if user.PasswordHash == nil {
				rt.Fatal("MigrateToPassword: expected non-nil password_hash")
			}
			if updatedHash == nil {
				rt.Fatal("MigrateToPassword: expected persisted non-nil password_hash")
			}
			if user.AuthMethodLock == nil || *user.AuthMethodLock != "password" {
				rt.Fatalf("MigrateToPassword: expected lock=password, got %v", user.AuthMethodLock)
			}
			if updatedLock == nil || *updatedLock != "password" {
				rt.Fatalf("MigrateToPassword: expected persisted lock=password, got %v", updatedLock)
			}
		}
	})
}

// Property 4: Migration preconditions.
//
// MigrateToSSO fails (and persists nothing) when the user has no linked SSO
// identity. MigrateToPassword fails (and persists nothing) when the new
// password does not satisfy the configured policy.
//
// Validates: Requirements 2.2, 2.4
func TestProperty_Migration_Preconditions(t *testing.T) {
	rapid.Check(t, func(rt *rapid.T) {
		which := rapid.SampledFrom([]string{"sso-no-identity", "password-weak"}).Draw(rt, "which")
		userID := uuid.New()

		updateCalled := false
		revokeAllCalled := false

		existingHash := "existing-hash"
		db := &mockDBTX{
			queryRowHandler: func(sql string, args ...any) pgx.Row {
				if strings.Contains(sql, "FROM users") {
					return userScanRow(userID, "u@corp.com", &existingHash, nil)
				}
				return &mockRow{err: pgx.ErrNoRows}
			},
			queryHandler: func(sql string, args ...any) (pgx.Rows, error) {
				// No linked identities.
				return &mockRows{}, nil
			},
			execHandler: func(sql string, args ...any) (pgconn.CommandTag, error) {
				switch {
				case strings.Contains(sql, "UPDATE users"):
					updateCalled = true
				case strings.Contains(sql, "UPDATE sessions"):
					revokeAllCalled = true
				}
				return pgconn.NewCommandTag("OK"), nil
			},
		}

		// A strict policy so any short, all-lowercase password is rejected.
		cfg := &config.Config{}
		cfg.Password = config.PasswordConfig{
			MinLength:        12,
			RequireUppercase: true,
			RequireLowercase: true,
			RequireNumber:    true,
			RequireSpecial:   true,
			BcryptCost:       4,
		}

		svc := newMigrationTestService(db, cfg)

		var err error
		switch which {
		case "sso-no-identity":
			_, err = svc.MigrateToSSO(context.Background(), userID)
		case "password-weak":
			weak := rapid.StringMatching(`[a-z]{1,8}`).Draw(rt, "weakPassword")
			_, err = svc.MigrateToPassword(context.Background(), userID, weak)
		}

		if err == nil {
			rt.Fatalf("which=%q: expected migration to be rejected, got nil error", which)
		}
		if updateCalled {
			rt.Fatalf("which=%q: a rejected migration must not persist a user update", which)
		}
		if revokeAllCalled {
			rt.Fatalf("which=%q: a rejected migration must not revoke sessions", which)
		}
	})
}
