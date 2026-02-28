package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/mailer"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

type OrgService struct {
	pool    *pgxpool.Pool
	orgRepo *postgres.OrgRepo
	mailer  *mailer.Mailer
	baseURL string
}

func NewOrgService(pool *pgxpool.Pool, orgRepo *postgres.OrgRepo, mailer *mailer.Mailer, baseURL string) *OrgService {
	return &OrgService{pool: pool, orgRepo: orgRepo, mailer: mailer, baseURL: baseURL}
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func generateSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "org"
	}
	return s
}

func (s *OrgService) CreateOrg(ctx context.Context, input domain.CreateOrgInput, creatorID uuid.UUID) (*domain.Organization, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	slug := generateSlug(input.Name)

	// Check slug uniqueness, append random suffix if taken
	if _, err := s.orgRepo.GetBySlug(ctx, slug); err == nil {
		b := make([]byte, 3)
		rand.Read(b)
		slug = slug + "-" + hex.EncodeToString(b)
	}

	org := &domain.Organization{
		ID:   uuid.New(),
		Name: input.Name,
		Slug: slug,
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)

	if err := orgRepoTx.Create(ctx, org); err != nil {
		return nil, err
	}

	membership := &domain.OrgMembership{
		ID:     uuid.New(),
		UserID: creatorID,
		OrgID:  org.ID,
		Role:   "owner",
	}
	if err := orgRepoTx.CreateMembership(ctx, membership); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return org, nil
}

func (s *OrgService) GetOrg(ctx context.Context, orgID uuid.UUID) (*domain.Organization, error) {
	return s.orgRepo.GetByID(ctx, orgID)
}

func (s *OrgService) ListUserOrgs(ctx context.Context, userID uuid.UUID, page, perPage int) ([]domain.Organization, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.orgRepo.ListByUser(ctx, userID, page, perPage)
}

func (s *OrgService) UpdateOrg(ctx context.Context, orgID uuid.UUID, input domain.UpdateOrgInput) (*domain.Organization, error) {
	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}

	if input.Name != nil {
		org.Name = *input.Name
		org.Slug = generateSlug(*input.Name)
	}
	if input.LogoURL != nil {
		org.LogoURL = input.LogoURL
	}

	if err := s.orgRepo.Update(ctx, org); err != nil {
		return nil, err
	}
	return org, nil
}

func (s *OrgService) DeleteOrg(ctx context.Context, orgID uuid.UUID) error {
	return s.orgRepo.Delete(ctx, orgID)
}

func (s *OrgService) UpdateSettings(ctx context.Context, orgID uuid.UUID, settings domain.OrgSettings) (*domain.Organization, error) {
	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}

	// Validate ranges
	if settings.MaxAttachmentSizeMB != nil && *settings.MaxAttachmentSizeMB < 1 {
		return nil, fmt.Errorf("max_attachment_size_mb must be >= 1")
	}
	if settings.MaxDomains != nil && *settings.MaxDomains < 1 {
		return nil, fmt.Errorf("max_domains must be >= 1")
	}
	if settings.MaxTeams != nil && *settings.MaxTeams < 1 {
		return nil, fmt.Errorf("max_teams must be >= 1")
	}
	if settings.MaxInboxesPerDomain != nil && *settings.MaxInboxesPerDomain < 1 {
		return nil, fmt.Errorf("max_inboxes_per_domain must be >= 1")
	}

	// Merge: only overwrite fields that are provided
	if settings.AttachmentsEnabled != nil {
		org.Settings.AttachmentsEnabled = settings.AttachmentsEnabled
	}
	if settings.DefaultInboxTTL != nil {
		org.Settings.DefaultInboxTTL = settings.DefaultInboxTTL
	}
	if settings.MaxInboxTTL != nil {
		org.Settings.MaxInboxTTL = settings.MaxInboxTTL
	}
	if settings.MaxAttachmentSizeMB != nil {
		org.Settings.MaxAttachmentSizeMB = settings.MaxAttachmentSizeMB
	}
	if settings.MaxDomains != nil {
		org.Settings.MaxDomains = settings.MaxDomains
	}
	if settings.MaxTeams != nil {
		org.Settings.MaxTeams = settings.MaxTeams
	}
	if settings.MaxInboxesPerDomain != nil {
		org.Settings.MaxInboxesPerDomain = settings.MaxInboxesPerDomain
	}
	if settings.EnforceSSO != nil {
		org.Settings.EnforceSSO = settings.EnforceSSO
	}

	if err := s.orgRepo.Update(ctx, org); err != nil {
		return nil, err
	}
	return org, nil
}

func (s *OrgService) GetSettings(ctx context.Context, orgID uuid.UUID) (*domain.OrgSettings, error) {
	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}
	return &org.Settings, nil
}

// ── Members ──

func (s *OrgService) ListMembers(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.OrgMembership, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	return s.orgRepo.ListMembers(ctx, orgID, page, perPage)
}

func (s *OrgService) ChangeRole(ctx context.Context, orgID, targetUserID uuid.UUID, role string) error {
	if role != "owner" && role != "admin" && role != "member" {
		return fmt.Errorf("invalid role: %s", role)
	}

	// Prevent removing the last owner
	current, err := s.orgRepo.GetMembership(ctx, targetUserID, orgID)
	if err != nil {
		return err
	}
	if current.Role == "owner" && role != "owner" {
		count, err := s.orgRepo.CountOwners(ctx, orgID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return fmt.Errorf("cannot remove the last owner")
		}
	}

	return s.orgRepo.UpdateMemberRole(ctx, targetUserID, orgID, role)
}

func (s *OrgService) RemoveMember(ctx context.Context, orgID, targetUserID uuid.UUID) error {
	m, err := s.orgRepo.GetMembership(ctx, targetUserID, orgID)
	if err != nil {
		return err
	}
	if m.Role == "owner" {
		count, err := s.orgRepo.CountOwners(ctx, orgID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return fmt.Errorf("cannot remove the last owner")
		}
	}
	return s.orgRepo.DeleteMembership(ctx, targetUserID, orgID)
}

// ── Invites ──

func (s *OrgService) InviteMember(ctx context.Context, orgID uuid.UUID, input domain.InviteMemberInput, inviterID uuid.UUID) (*domain.Invite, error) {
	if input.Email == "" {
		return nil, fmt.Errorf("email is required")
	}
	if input.OrgRole != "owner" && input.OrgRole != "admin" && input.OrgRole != "member" {
		return nil, fmt.Errorf("invalid org_role: %s", input.OrgRole)
	}

	b := make([]byte, 32)
	rand.Read(b)
	token := hex.EncodeToString(b)

	var teamID *uuid.UUID
	if input.TeamID != nil {
		id, err := uuid.Parse(*input.TeamID)
		if err != nil {
			return nil, fmt.Errorf("invalid team_id")
		}
		teamID = &id
	}

	invite := &domain.Invite{
		ID:        uuid.New(),
		OrgID:     orgID,
		TeamID:    teamID,
		Email:     input.Email,
		OrgRole:   input.OrgRole,
		TeamRole:  input.TeamRole,
		Token:     token,
		InvitedBy: &inviterID,
		ExpiresAt: time.Now().Add(48 * time.Hour),
	}

	if err := s.orgRepo.CreateInvite(ctx, invite); err != nil {
		return nil, err
	}

	// Send invite email
	go func() {
		orgName := ""
		if org, err := s.orgRepo.GetByID(ctx, orgID); err == nil {
			orgName = org.Name
		}
		acceptURL := fmt.Sprintf("%s/invite?token=%s", s.baseURL, token)
		if err := s.mailer.Send(input.Email, "You've been invited", "invite.html", map[string]string{
			"OrgName":     orgName,
			"InviterName": "A team member",
			"AcceptURL":   acceptURL,
		}); err != nil {
			slog.Error("failed to send invite email", "error", err)
		}
	}()

	return invite, nil
}

func (s *OrgService) AcceptInvite(ctx context.Context, token string, userID uuid.UUID) error {
	invite, err := s.orgRepo.GetInviteByToken(ctx, token)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return fmt.Errorf("invite not found")
		}
		return err
	}

	// Idempotent: already accepted
	if invite.AcceptedAt != nil {
		return nil
	}

	if time.Now().After(invite.ExpiresAt) {
		return fmt.Errorf("invite expired")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)

	membership := &domain.OrgMembership{
		ID:     uuid.New(),
		UserID: userID,
		OrgID:  invite.OrgID,
		Role:   invite.OrgRole,
	}

	if err := orgRepoTx.CreateMembership(ctx, membership); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			// Already a member — idempotent
			return orgRepoTx.MarkInviteAccepted(ctx, invite.ID)
		}
		return err
	}

	if err := orgRepoTx.MarkInviteAccepted(ctx, invite.ID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *OrgService) GetMembership(ctx context.Context, userID, orgID uuid.UUID) (*domain.OrgMembership, error) {
	return s.orgRepo.GetMembership(ctx, userID, orgID)
}

func (s *OrgService) ListAll(ctx context.Context, page, perPage int) ([]domain.Organization, int, error) {
	return s.orgRepo.ListAll(ctx, page, perPage)
}
