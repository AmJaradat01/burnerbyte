package handler

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/mailer"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// Thin wrappers for testability
var (
	smtpDial = func(addr string) (*smtp.Client, error) {
		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			return nil, err
		}
		conn.SetDeadline(time.Now().Add(10 * time.Second))
		host, _, _ := net.SplitHostPort(addr)
		client, err := smtp.NewClient(conn, host)
		if err != nil {
			conn.Close()
			return nil, err
		}
		// Clear deadline — individual operations set their own via the smtp.Client
		conn.SetDeadline(time.Time{})
		return client, nil
	}
	smtpPlainAuth = smtp.PlainAuth
	smtpTLSDial   = func(addr, host string) (net.Conn, error) {
		return tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", addr, &tls.Config{ServerName: host})
	}
	smtpNewClient = func(conn net.Conn, host string) (*smtp.Client, error) { return smtp.NewClient(conn, host) }
	minioNew      = func(endpoint, accessKey, secretKey string, useSSL bool) (*minio.Client, error) {
		return minio.New(endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
			Secure: useSSL,
		})
	}
)

// smtpDialTest opens an SMTP connection (authenticating if a username is given),
// closes it, and reports the round-trip time. It performs NO SSRF validation:
// callers that accept untrusted input (the unauthenticated setup endpoint) must
// validate the host first. Authenticated callers testing an operator-configured
// relay (which may legitimately sit on a private network) call it directly.
func smtpDialTest(host string, port int, username, password string, useTLS bool) (time.Duration, error) {
	start := time.Now()
	addr := fmt.Sprintf("%s:%d", host, port)
	if useTLS {
		conn, err := smtpTLSDial(addr, host)
		if err != nil {
			return time.Since(start), err
		}
		client, err := smtpNewClient(conn, host)
		if err != nil {
			return time.Since(start), err
		}
		defer client.Close()
		if username != "" {
			if err := client.Auth(smtpPlainAuth("", username, password, host)); err != nil {
				return time.Since(start), fmt.Errorf("authentication failed: %w", err)
			}
		}
		client.Quit()
		return time.Since(start), nil
	}
	conn, err := smtpDial(addr)
	if err != nil {
		return time.Since(start), err
	}
	defer conn.Close()
	// Explicitly issue EHLO so extensions (like STARTTLS) are populated.
	if err := conn.Hello("localhost"); err != nil {
		return time.Since(start), fmt.Errorf("EHLO failed: %w", err)
	}
	// Port 587 (submission) typically requires STARTTLS before AUTH.
	if ok, _ := conn.Extension("STARTTLS"); ok {
		if err := conn.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return time.Since(start), fmt.Errorf("STARTTLS failed: %w", err)
		}
	}
	if username != "" {
		if err := conn.Auth(smtpPlainAuth("", username, password, host)); err != nil {
			return time.Since(start), fmt.Errorf("authentication failed: %w", err)
		}
	}
	conn.Quit()
	return time.Since(start), nil
}

type SetupHandler struct {
	pool          *pgxpool.Pool
	userRepo      *postgres.UserRepo
	orgRepo       *postgres.OrgRepo
	domainRepo    *postgres.DomainRepo
	teamRepo      *postgres.TeamRepo
	sessionRepo   *postgres.SessionRepo
	sysConfigRepo *postgres.SystemConfigRepo
	tokens        *auth.TokenManager
	mailer        *mailer.Mailer
	cfg           *config.Config
}

func NewSetupHandler(
	pool *pgxpool.Pool,
	userRepo *postgres.UserRepo,
	orgRepo *postgres.OrgRepo,
	domainRepo *postgres.DomainRepo,
	teamRepo *postgres.TeamRepo,
	sessionRepo *postgres.SessionRepo,
	sysConfigRepo *postgres.SystemConfigRepo,
	tokens *auth.TokenManager,
	mailer *mailer.Mailer,
	cfg *config.Config,
) *SetupHandler {
	return &SetupHandler{
		pool: pool, userRepo: userRepo, orgRepo: orgRepo,
		domainRepo: domainRepo, teamRepo: teamRepo,
		sessionRepo: sessionRepo, sysConfigRepo: sysConfigRepo,
		tokens: tokens, mailer: mailer, cfg: cfg,
	}
}

func (h *SetupHandler) Routes(r chi.Router) {
	r.Route("/setup", func(r chi.Router) {
		r.Get("/status", h.Status)
		r.Post("/complete", h.Complete)
		r.Post("/test-smtp", h.TestSMTP)
		r.Post("/test-storage", h.TestStorage)
	})
}

type SetupInput struct {
	// UseCookie opts into the httpOnly refresh-token cookie (browser clients);
	// the refresh token is then omitted from the JSON response.
	UseCookie bool `json:"use_cookie"`

	// Step 1: Admin (required)
	Admin struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	} `json:"admin"`

	// Step 2: Organization (required)
	Org struct {
		Name    string  `json:"name"`
		Slug    string  `json:"slug,omitempty"`
		LogoURL *string `json:"logo_url,omitempty"`
	} `json:"org"`

	// Step 3: SMTP (required)
	SMTP struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
		FromAddr string `json:"from_address"`
		FromName string `json:"from_name"`
	} `json:"smtp"`

	// Step 4: Storage (required)
	Storage *struct {
		Provider  string `json:"provider"` // "minio" or "s3"
		Endpoint  string `json:"endpoint"`
		AccessKey string `json:"access_key"`
		SecretKey string `json:"secret_key"`
		Bucket    string `json:"bucket"`
		Region    string `json:"region,omitempty"`
		UseSSL    bool   `json:"use_ssl"`
	} `json:"storage,omitempty"`

	// Step 5: Domain (required)
	Domain struct {
		DomainName string `json:"domain_name"`
	} `json:"domain"`

	// Step 6: Team (optional)
	Team *struct {
		Name string `json:"name"`
	} `json:"team,omitempty"`

	// Step 6: Branding (optional)
	Branding *struct {
		LogoURL *string `json:"logo_url,omitempty"`
	} `json:"branding,omitempty"`

	// Step 7: Invites (optional)
	Invites []struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	} `json:"invites,omitempty"`
}

// redactDSN reduces a connection string to "host:port/database" — enough for an
// operator to confirm which instance they are about to write to, with the
// credentials removed. A DSN that will not parse is reported as "(unparsable)"
// rather than echoed back, so a malformed value can never leak its password.
func redactDSN(dsn string) string {
	if strings.TrimSpace(dsn) == "" {
		return "(not configured)"
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Host == "" {
		return "(unparsable)"
	}
	if path := strings.TrimPrefix(u.Path, "/"); path != "" {
		return u.Host + "/" + path
	}
	return u.Host
}

func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	completed, err := h.isSetupCompleted(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check setup status")
		return
	}

	body := map[string]any{"completed": completed}

	// Which datastores this instance is wired to. Database and Redis are the two
	// settings the wizard cannot change — they are resolved before the process
	// can connect — so showing them is the only way an operator can confirm they
	// are configuring the intended instance rather than, say, a local Postgres
	// left over from a previous run. Credentials are stripped, and the field is
	// withheld once setup completes, matching the test-* endpoints: before that
	// point anyone reachable can claim the instance anyway, so a hostname is not
	// the sensitive part.
	if !completed {
		body["datastores"] = map[string]string{
			"postgres": redactDSN(h.cfg.Database.URL),
			"redis":    redactDSN(h.cfg.Redis.URL),
		}
	}

	writeJSON(w, http.StatusOK, body)
}

func (h *SetupHandler) Complete(w http.ResponseWriter, r *http.Request) {
	var input SetupInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if input.Admin.Email == "" || input.Admin.Password == "" || input.Admin.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "admin email, password, and display name are required")
		return
	}
	if _, err := mail.ParseAddress(input.Admin.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid admin email format")
		return
	}
	if err := auth.ValidateDisplayName(input.Admin.DisplayName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.Org.Name == "" {
		writeError(w, http.StatusBadRequest, "organization name is required")
		return
	}
	if input.SMTP.Host == "" || input.SMTP.Port == 0 || input.SMTP.FromAddr == "" {
		writeError(w, http.StatusBadRequest, "SMTP host, port, and from address are required")
		return
	}
	if input.Domain.DomainName == "" {
		writeError(w, http.StatusBadRequest, "at least one domain is required")
		return
	}

	// Validate password policy
	if err := auth.ValidatePassword(input.Admin.Password, h.cfg.PasswordPolicy()); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Run everything in a transaction
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// Check setup inside transaction with row lock to prevent TOCTOU race
	var completed bool
	if err := tx.QueryRow(r.Context(), "SELECT completed FROM setup_state WHERE id = TRUE FOR UPDATE").Scan(&completed); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check setup status")
		return
	}
	if completed {
		writeError(w, http.StatusConflict, "setup already completed")
		return
	}

	userRepoTx := h.userRepo.WithTx(tx)
	orgRepoTx := h.orgRepo.WithTx(tx)
	domainRepoTx := h.domainRepo.WithTx(tx)
	sessionRepoTx := h.sessionRepo.WithTx(tx)

	// Step 1: Create admin user
	hash, err := auth.HashPassword(input.Admin.Password, h.cfg.PasswordPolicy())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}
	now := time.Now()
	adminUser := &domain.User{
		ID:                uuid.New(),
		Email:             input.Admin.Email,
		DisplayName:       input.Admin.DisplayName,
		PasswordHash:      &hash,
		IsSystemAdmin:     true,
		EmailVerified:     true,
		PasswordChangedAt: &now,
	}
	if err := userRepoTx.Create(r.Context(), adminUser); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			writeError(w, http.StatusConflict, "admin email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create admin user")
		return
	}

	// Step 2: Create organization
	slug := input.Org.Slug
	if slug == "" {
		slug = generateSlug(input.Org.Name)
	}
	org := &domain.Organization{
		ID:      uuid.New(),
		Name:    input.Org.Name,
		Slug:    slug,
		LogoURL: input.Org.LogoURL,
	}
	if err := orgRepoTx.Create(r.Context(), org); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create organization")
		return
	}

	// Add admin as org owner
	membership := &domain.OrgMembership{
		ID:     uuid.New(),
		UserID: adminUser.ID,
		OrgID:  org.ID,
		Role:   "owner",
	}
	if err := orgRepoTx.CreateMembership(r.Context(), membership); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add admin to org")
		return
	}

	// Step 3: Save SMTP config to DB (within transaction)
	sysConfigRepoTx := h.sysConfigRepo.WithTx(tx)
	smtpConfig := config.MailerConfig{
		Host:     input.SMTP.Host,
		Port:     input.SMTP.Port,
		Username: input.SMTP.Username,
		Password: input.SMTP.Password,
		From:     input.SMTP.FromAddr,
	}
	if err := sysConfigRepoTx.Set(r.Context(), "mailer", smtpConfig); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save SMTP config")
		return
	}

	// Step 4: Save storage config to DB (within transaction)
	if input.Storage != nil && input.Storage.Endpoint != "" {
		if err := sysConfigRepoTx.Set(r.Context(), "storage", input.Storage); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save storage config")
			return
		}
	}

	// Step 5: Add domain
	domainEntry := &domain.Domain{
		ID:         uuid.New(),
		OrgID:      org.ID,
		DomainName: input.Domain.DomainName,
	}
	if err := domainRepoTx.Create(r.Context(), domainEntry); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add domain")
		return
	}

	// Step 6: Create team (optional)
	var teamEntry *domain.Team
	if input.Team != nil && input.Team.Name != "" {
		teamRepoTx := h.teamRepo.WithTx(tx)
		teamEntry = &domain.Team{
			ID:    uuid.New(),
			OrgID: org.ID,
			Name:  input.Team.Name,
			Slug:  generateSlug(input.Team.Name),
		}
		if err := teamRepoTx.Create(r.Context(), teamEntry); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create team")
			return
		}
		// Add admin as team lead
		teamMember := &domain.TeamMembership{
			ID:     uuid.New(),
			UserID: adminUser.ID,
			TeamID: teamEntry.ID,
			Role:   "lead",
		}
		if err := teamRepoTx.CreateMembership(r.Context(), teamMember); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add admin to team")
			return
		}
	}

	// Step 6: Branding (optional)
	if input.Branding != nil {
		if input.Branding.LogoURL != nil {
			org.LogoURL = input.Branding.LogoURL
		}
		if err := orgRepoTx.Update(r.Context(), org); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save branding")
			return
		}
	}

	// Step 7: Invites (optional, create records in DB before commit)
	type inviteWithToken struct {
		Email string
		Role  string
		Token string
	}
	var inviteRecords []inviteWithToken
	for _, inv := range input.Invites {
		if inv.Email == "" {
			continue
		}
		if _, err := mail.ParseAddress(inv.Email); err != nil {
			slog.Warn("setup: skipping invite with invalid email", "email", inv.Email)
			continue
		}
		b := make([]byte, 32)
		rand.Read(b)
		token := hex.EncodeToString(b)
		invite := &domain.Invite{
			ID:        uuid.New(),
			OrgID:     org.ID,
			Email:     inv.Email,
			OrgRole:   inv.Role,
			Token:     token,
			InvitedBy: &adminUser.ID,
			ExpiresAt: time.Now().Add(h.cfg.RuntimeDefaults().InviteExpiryTTL),
		}
		if invite.OrgRole == "" {
			invite.OrgRole = "member"
		}
		if invite.ExpiresAt.Before(time.Now()) {
			invite.ExpiresAt = time.Now().Add(h.cfg.RuntimeDefaults().InviteExpiryTTL)
		}
		if err := orgRepoTx.CreateInvite(r.Context(), invite); err != nil {
			slog.Error("failed to create invite", "error", err, "email", inv.Email)
			continue
		}
		inviteRecords = append(inviteRecords, inviteWithToken{Email: inv.Email, Role: inv.Role, Token: token})
	}

	// Mark setup as completed
	_, err = tx.Exec(r.Context(),
		"UPDATE setup_state SET completed = TRUE, completed_at = $1, completed_by = $2 WHERE id = TRUE",
		now, adminUser.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark setup complete")
		return
	}

	// Create session for admin
	accessToken, err := h.tokens.GenerateAccessToken(adminUser.ID, adminUser.Email, adminUser.IsSystemAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	rawRefresh, refreshHash, err := h.tokens.GenerateRefreshToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	session := &domain.Session{
		ID:               uuid.New(),
		UserID:           adminUser.ID,
		RefreshTokenHash: refreshHash,
		TokenFamily:      uuid.New(),
		ExpiresAt:        time.Now().Add(h.tokens.RefreshTTL()),
	}
	if err := sessionRepoTx.Create(r.Context(), session); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit setup")
		return
	}

	// Apply in-memory config changes after successful commit
	h.cfg.Mailer = smtpConfig
	h.mailer.Reconfigure(smtpConfig)
	if input.Storage != nil && input.Storage.Endpoint != "" {
		h.cfg.MinIO = config.MinIOConfig{
			Endpoint:  input.Storage.Endpoint,
			AccessKey: input.Storage.AccessKey,
			SecretKey: input.Storage.SecretKey,
			Bucket:    input.Storage.Bucket,
			UseSSL:    input.Storage.UseSSL,
		}
	}

	// Send invites asynchronously after commit
	if len(inviteRecords) > 0 {
		go func() {
			for _, inv := range inviteRecords {
				inviteURL := fmt.Sprintf("%s/invite?token=%s", h.cfg.Server.FrontendURL, inv.Token)
				if err := h.mailer.Send(inv.Email, "You're invited to "+org.Name, "invite.html", map[string]string{
					"OrgName":     org.Name,
					"InviterName": "The platform admin",
					"AcceptURL":   inviteURL,
					"ExpiresIn":   mailer.HumanDuration(h.cfg.RuntimeDefaults().InviteExpiryTTL),
				}); err != nil {
					slog.Error("failed to send invite", "error", err, "email", inv.Email)
				}
			}
		}()
	}

	respTokens := domain.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresIn:    int64(h.tokens.AccessTTL().Seconds()),
	}
	if input.UseCookie {
		setRefreshCookie(w, r, h.cfg, rawRefresh)
		respTokens.RefreshToken = ""
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":   adminUser,
		"org":    org,
		"tokens": respTokens,
	})
}

func (h *SetupHandler) isSetupCompleted(ctx context.Context) (bool, error) {
	var completed bool
	err := h.pool.QueryRow(ctx, "SELECT completed FROM setup_state WHERE id = TRUE").Scan(&completed)
	if err != nil {
		return false, err
	}
	return completed, nil
}

func generateSlug(name string) string {
	slug := ""
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			slug += string(c)
		} else if c >= 'A' && c <= 'Z' {
			slug += string(c + 32)
		} else if c == ' ' {
			slug += "-"
		}
	}
	return slug
}

// TestSMTP tests SMTP connectivity with the provided credentials.
// This is an unauthenticated endpoint available during setup.
func (h *SetupHandler) TestSMTP(w http.ResponseWriter, r *http.Request) {
	completed, _ := h.isSetupCompleted(r.Context())
	if completed {
		writeError(w, http.StatusForbidden, "setup already completed")
		return
	}

	var input struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
		TLS      bool   `json:"tls"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Host == "" || input.Port == 0 {
		writeError(w, http.StatusBadRequest, "host and port are required")
		return
	}

	// Prevent SSRF - validate target is not a private IP
	resolveHost := input.Host
	if h2, _, err := net.SplitHostPort(resolveHost); err == nil {
		resolveHost = h2
	}
	ips, err := net.LookupIP(resolveHost)
	if err != nil {
		writeError(w, http.StatusBadRequest, "cannot resolve host")
		return
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
			writeError(w, http.StatusBadRequest, "target host resolves to a private IP address")
			return
		}
	}

	elapsed, testErr := smtpDialTest(input.Host, input.Port, input.Username, input.Password, input.TLS)
	if testErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success":       false,
			"message":       testErr.Error(),
			"response_time": elapsed.String(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"message":       fmt.Sprintf("Connected to %s:%d successfully", input.Host, input.Port),
		"response_time": elapsed.String(),
	})
}

// TestStorage tests S3/MinIO connectivity with the provided credentials.
// This is an unauthenticated endpoint available during setup.
func (h *SetupHandler) TestStorage(w http.ResponseWriter, r *http.Request) {
	completed, _ := h.isSetupCompleted(r.Context())
	if completed {
		writeError(w, http.StatusForbidden, "setup already completed")
		return
	}

	var input struct {
		Endpoint  string `json:"endpoint"`
		AccessKey string `json:"access_key"`
		SecretKey string `json:"secret_key"`
		Bucket    string `json:"bucket"`
		UseSSL    bool   `json:"use_ssl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "endpoint is required")
		return
	}

	// Prevent SSRF - validate target is not a private IP
	resolveHost := input.Endpoint
	if h2, _, err := net.SplitHostPort(resolveHost); err == nil {
		resolveHost = h2
	}
	ips, err := net.LookupIP(resolveHost)
	if err != nil {
		writeError(w, http.StatusBadRequest, "cannot resolve host")
		return
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
			writeError(w, http.StatusBadRequest, "target host resolves to a private IP address")
			return
		}
	}

	start := time.Now()

	client, err := minioNew(input.Endpoint, input.AccessKey, input.SecretKey, input.UseSSL)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success":       false,
			"message":       fmt.Sprintf("Failed to create client: %s", err.Error()),
			"response_time": time.Since(start).String(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	bucket := input.Bucket
	if bucket == "" {
		bucket = "burnerbyte"
	}

	exists, err := client.BucketExists(ctx, bucket)
	elapsed := time.Since(start)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success":       false,
			"message":       fmt.Sprintf("Connection failed: %s", err.Error()),
			"response_time": elapsed.String(),
		})
		return
	}

	msg := fmt.Sprintf("Connected to %s successfully", input.Endpoint)
	if exists {
		msg += fmt.Sprintf(" (bucket '%s' exists)", bucket)
	} else {
		msg += fmt.Sprintf(" (bucket '%s' does not exist — will be created on setup)", bucket)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"message":       msg,
		"bucket_exists": exists,
		"response_time": elapsed.String(),
	})
}
