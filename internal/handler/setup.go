package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth"
	"gitlab.com/amjaradat01/burnerbyte/internal/config"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/mailer"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
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
		PrimaryColor *string `json:"primary_color,omitempty"`
		FooterText   *string `json:"footer_text,omitempty"`
		LogoURL      *string `json:"logo_url,omitempty"`
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
	completed, err := h.isSetupCompleted(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check setup status")
		return
	}
	if completed {
		writeError(w, http.StatusConflict, "setup already completed")
		return
	}

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
		settings := org.Settings
		if input.Branding.PrimaryColor != nil {
			settings.PrimaryColor = input.Branding.PrimaryColor
		}
		if input.Branding.FooterText != nil {
			settings.FooterText = input.Branding.FooterText
		}
		if input.Branding.LogoURL != nil {
			org.LogoURL = input.Branding.LogoURL
		}
		org.Settings = settings
		if err := orgRepoTx.Update(r.Context(), org); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save branding")
			return
		}
	}

	// Step 7: Invites (optional, sent after commit)
	inviteEmails := input.Invites

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
	rawRefresh, refreshHash, _ := h.tokens.GenerateRefreshToken()
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
	if len(inviteEmails) > 0 {
		go func() {
			for _, inv := range inviteEmails {
				inviteURL := fmt.Sprintf("%s/invite?org=%s&email=%s", h.cfg.Server.FrontendURL, org.ID, inv.Email)
				if err := h.mailer.Send(inv.Email, "You're invited to "+org.Name, "invite.html", map[string]string{
					"OrgName":   org.Name,
					"InviteURL": inviteURL,
					"Role":      inv.Role,
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
