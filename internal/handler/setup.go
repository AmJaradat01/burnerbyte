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
	"net/smtp"
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
	smtpDial      = func(addr string) (*smtp.Client, error) { return smtp.Dial(addr) }
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

type SetupHandler struct {
	pool            *pgxpool.Pool
	userRepo        *postgres.UserRepo
	orgRepo         *postgres.OrgRepo
	domainRepo      *postgres.DomainRepo
	teamRepo        *postgres.TeamRepo
	sessionRepo     *postgres.SessionRepo
	sysConfigRepo   *postgres.SystemConfigRepo
	tokens          *auth.TokenManager
	mailer          *mailer.Mailer
	cfg             *config.Config
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

func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	completed, err := h.isSetupCompleted(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check setup status")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"completed": completed})
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
	if err := auth.ValidatePassword(input.Admin.Password, h.cfg.Password); err != nil {
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
	hash, err := auth.HashPassword(input.Admin.Password)
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
			ExpiresAt: time.Now().Add(h.cfg.Defaults.InviteExpiryTTL),
		}
		if invite.OrgRole == "" {
			invite.OrgRole = "member"
		}
		if invite.ExpiresAt.Before(time.Now()) {
			invite.ExpiresAt = time.Now().Add(h.cfg.Defaults.InviteExpiryTTL)
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
	if err != nil { writeError(w, http.StatusInternalServerError, "failed to generate token"); return }
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
					"ExpiresIn":   mailer.HumanDuration(h.cfg.Defaults.InviteExpiryTTL),
				}); err != nil {
					slog.Error("failed to send invite", "error", err, "email", inv.Email)
				}
			}
		}()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": adminUser,
		"org":  org,
		"tokens": domain.TokenPair{
			AccessToken:  accessToken,
			RefreshToken: rawRefresh,
			ExpiresIn:    int64(h.tokens.AccessTTL().Seconds()),
		},
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

	start := time.Now()
	addr := fmt.Sprintf("%s:%d", input.Host, input.Port)

	var testErr error
	if input.TLS {
		conn, err := smtpTLSDial(addr, input.Host)
		if err != nil {
			testErr = err
		} else {
			client, err := smtpNewClient(conn, input.Host)
			if err != nil {
				testErr = err
			} else {
				if input.Username != "" {
					if err := client.Auth(smtpPlainAuth("", input.Username, input.Password, input.Host)); err != nil {
						testErr = fmt.Errorf("authentication failed: %w", err)
					}
				}
				client.Quit()
				client.Close()
			}
		}
	} else {
		conn, err := smtpDial(addr)
		if err != nil {
			testErr = err
		} else {
			if input.Username != "" {
				if err := conn.Auth(smtpPlainAuth("", input.Username, input.Password, input.Host)); err != nil {
					testErr = fmt.Errorf("authentication failed: %w", err)
				}
			}
			conn.Quit()
			conn.Close()
		}
	}

	elapsed := time.Since(start)
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
		"message":       fmt.Sprintf("Connected to %s successfully", addr),
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
