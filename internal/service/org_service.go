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
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/amjaradat01/burnerbyte/internal/auth/rbac"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
	"gitlab.com/amjaradat01/burnerbyte/internal/mailer"
	"gitlab.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// DNS resolution hooks for invite email-domain validation. They are package
// variables so tests can substitute deterministic resolvers; production uses
// the net package.
var (
	lookupMX   = net.LookupMX
	lookupHost = net.LookupHost
)

type OrgService struct {
	pool            *pgxpool.Pool
	orgRepo         *postgres.OrgRepo
	teamRepo        *postgres.TeamRepo
	userRepo        *postgres.UserRepo
	ssoProviderRepo *postgres.SSOProviderRepo
	mailer          *mailer.Mailer
	baseURL         string
	inviteExpiry    time.Duration
}

func NewOrgService(pool *pgxpool.Pool, orgRepo *postgres.OrgRepo, teamRepo *postgres.TeamRepo, userRepo *postgres.UserRepo, ssoProviderRepo *postgres.SSOProviderRepo, mailer *mailer.Mailer, baseURL string, inviteExpiry time.Duration) *OrgService {
	if inviteExpiry <= 0 {
		inviteExpiry = 48 * time.Hour
	}
	return &OrgService{pool: pool, orgRepo: orgRepo, teamRepo: teamRepo, userRepo: userRepo, ssoProviderRepo: ssoProviderRepo, mailer: mailer, baseURL: baseURL, inviteExpiry: inviteExpiry}
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// emailDomainRe validates the domain part of an email: requires labels separated by dots,
// with a TLD of at least 2 characters. Rejects things like "hgfhgf.v" or "foo..bar.com".
var emailDomainRe = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$`)

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
	// Single-org enforcement
	count, err := s.orgRepo.Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("check existing orgs: %w", err)
	}
	if count > 0 {
		return nil, fmt.Errorf("organization already exists")
	}

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
		Role:   rbac.OrgOwner,
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

// DirectAddMember adds an existing user directly to the org without the invite flow.
// Used for single-org systems where the admin wants to add a user who already has an account.
func (s *OrgService) DirectAddMember(ctx context.Context, orgID, userID uuid.UUID, role string) error {
	if !rbac.ValidOrgRole(role) {
		return fmt.Errorf("invalid role: %s", role)
	}
	// Verify user exists
	if s.userRepo != nil {
		if _, err := s.userRepo.GetByID(ctx, userID); err != nil {
			return fmt.Errorf("user not found")
		}
	}
	membership := &domain.OrgMembership{
		ID:     uuid.New(),
		UserID: userID,
		OrgID:  orgID,
		Role:   role,
	}
	if err := s.orgRepo.CreateMembership(ctx, membership); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return fmt.Errorf("user is already a member of this organization")
		}
		return err
	}
	return nil
}

func (s *OrgService) ChangeRole(ctx context.Context, orgID, targetUserID uuid.UUID, role string) error {
	if !rbac.ValidOrgRole(role) {
		return fmt.Errorf("invalid role: %s", role)
	}

	// Prevent removing the last owner
	current, err := s.orgRepo.GetMembership(ctx, targetUserID, orgID)
	if err != nil {
		return err
	}
	if current.Role == rbac.OrgOwner && role != rbac.OrgOwner {
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

// DeactivateUser removes a user from the org, all teams, and revokes sessions.
// The user account is preserved for audit trail purposes.
func (s *OrgService) DeactivateUser(ctx context.Context, orgID, targetUserID uuid.UUID) error {
	// Verify user is a member
	m, err := s.orgRepo.GetMembership(ctx, targetUserID, orgID)
	if err != nil {
		return fmt.Errorf("user is not a member of this organization")
	}
	// Prevent deactivating the last owner
	if m.Role == rbac.OrgOwner {
		count, err := s.orgRepo.CountOwners(ctx, orgID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return fmt.Errorf("cannot deactivate the last owner")
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)

	// 1. Remove from all teams in this org
	_, err = tx.Exec(ctx,
		`DELETE FROM team_memberships WHERE user_id = $1 AND team_id IN (SELECT id FROM teams WHERE org_id = $2)`,
		targetUserID, orgID)
	if err != nil {
		return fmt.Errorf("remove team memberships: %w", err)
	}

	// 2. Remove org membership
	if err := orgRepoTx.DeleteMembership(ctx, targetUserID, orgID); err != nil {
		return fmt.Errorf("remove org membership: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return nil
}

// ── Invites ──

func (s *OrgService) InviteMember(ctx context.Context, orgID uuid.UUID, input domain.InviteMemberInput, inviterID uuid.UUID) (*domain.Invite, error) {
	if input.Email == "" {
		return nil, fmt.Errorf("email is required")
	}
	// Validate email format: net/mail for RFC compliance + stricter domain check
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if _, err := mail.ParseAddress(input.Email); err != nil {
		return nil, fmt.Errorf("invalid email format")
	}
	// Require a real-looking domain: at least one dot, TLD >= 2 chars, no consecutive dots
	parts := strings.SplitN(input.Email, "@", 2)
	if len(parts) != 2 || !emailDomainRe.MatchString(parts[1]) {
		return nil, fmt.Errorf("invalid email domain")
	}
	// DNS check: verify the domain has MX or A records (catches completely fake domains)
	emailDomain := parts[1]
	if _, err := lookupMX(emailDomain); err != nil {
		// No MX records — try A record as fallback (some domains deliver mail via A)
		if _, err := lookupHost(emailDomain); err != nil {
			return nil, fmt.Errorf("email domain %q does not exist or has no mail server", emailDomain)
		}
	}
	if !rbac.ValidOrgRole(input.OrgRole) {
		return nil, fmt.Errorf("invalid org_role: %s", input.OrgRole)
	}

	// Validate allowed_auth: default to ["any"] if empty/nil
	allowedAuth := input.AllowedAuth
	if len(allowedAuth) == 0 {
		allowedAuth = []string{"any"}
	}
	if err := s.validateAllowedAuth(ctx, allowedAuth); err != nil {
		return nil, err
	}

	// Validate team_assignments
	if err := s.validateTeamAssignments(ctx, orgID, input.TeamAssignments); err != nil {
		return nil, err
	}

	// Delete any existing pending invite for this email+org (prevents duplicates on resend)
	_ = s.orgRepo.DeletePendingInviteByEmail(ctx, orgID, input.Email)

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

		// Validate team belongs to this org
		team, err := s.teamRepo.GetByID(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("team not found")
		}
		if team.OrgID != orgID {
			return nil, fmt.Errorf("team does not belong to this organization")
		}

		// Default team_role to "member" when team_id is provided but team_role is nil
		if input.TeamRole == nil {
			defaultRole := "member"
			input.TeamRole = &defaultRole
		} else if !rbac.ValidTeamRole(*input.TeamRole) {
			return nil, fmt.Errorf("invalid team_role: %s", *input.TeamRole)
		}
	}

	invite := &domain.Invite{
		ID:          uuid.New(),
		OrgID:       orgID,
		TeamID:      teamID,
		Email:       input.Email,
		OrgRole:     input.OrgRole,
		AllowedAuth: allowedAuth,
		TeamRole:    input.TeamRole,
		Token:       token,
		InvitedBy:   &inviterID,
		ExpiresAt:   time.Now().Add(s.inviteExpiry),
	}

	// Use a transaction to persist invite + team assignments atomically
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)

	if err := orgRepoTx.CreateInvite(ctx, invite); err != nil {
		return nil, err
	}

	if len(input.TeamAssignments) > 0 {
		if err := orgRepoTx.CreateInviteTeamAssignments(ctx, invite.ID, input.TeamAssignments); err != nil {
			return nil, fmt.Errorf("create team assignments: %w", err)
		}
		invite.TeamAssignments = input.TeamAssignments
	}

	if err := tx.Commit(ctx); err != nil {
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
			"ExpiresIn":   mailer.HumanDuration(s.inviteExpiry),
		}); err != nil {
			slog.Error("failed to send invite email", "error", err)
		}
	}()

	return invite, nil
}

// AcceptInviteResult holds the result of accepting an invite, including optional team info.
type AcceptInviteResult struct {
	OrgID           uuid.UUID                  `json:"org_id"`
	OrgName         string                     `json:"org_name"`
	TeamID          *uuid.UUID                 `json:"team_id,omitempty"`
	TeamName        string                     `json:"team_name,omitempty"`
	TeamRole        string                     `json:"team_role,omitempty"`
	TeamAssignments []domain.InviteTeamAssign   `json:"team_assignments,omitempty"`
}

func (s *OrgService) AcceptInvite(ctx context.Context, token string, userID uuid.UUID, userEmail string) (*AcceptInviteResult, error) {
	invite, err := s.orgRepo.GetInviteByToken(ctx, token)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return nil, fmt.Errorf("invite not found")
		}
		return nil, err
	}

	// Idempotent: already accepted
	if invite.AcceptedAt != nil {
		orgName := ""
		if org, err := s.orgRepo.GetByID(ctx, invite.OrgID); err == nil {
			orgName = org.Name
		}
		return &AcceptInviteResult{OrgID: invite.OrgID, OrgName: orgName}, nil
	}

	if time.Now().After(invite.ExpiresAt) {
		return nil, fmt.Errorf("invite expired")
	}

	// Security: verify the accepting user's email matches the invite
	if !strings.EqualFold(invite.Email, userEmail) {
		slog.Warn("invite email mismatch",
			"invite_email", invite.Email,
			"user_email", userEmail,
			"user_id", userID,
			"invite_id", invite.ID,
		)
		return nil, fmt.Errorf("email mismatch: this invite was sent to a different email address")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)
	teamRepoTx := s.teamRepo.WithTx(tx)

	membership := &domain.OrgMembership{
		ID:     uuid.New(),
		UserID: userID,
		OrgID:  invite.OrgID,
		Role:   invite.OrgRole,
	}

	if err := orgRepoTx.CreateMembership(ctx, membership); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			// Already a member — just mark invite accepted
		} else {
			return nil, err
		}
	}

	// Multi-team assignment processing
	var resultTeamID *uuid.UUID
	var resultTeamName string
	var resultTeamRole string
	var resultAssignments []domain.InviteTeamAssign

	// Fetch invite_team_assignments
	assignments, assignErr := orgRepoTx.GetInviteTeamAssignments(ctx, invite.ID)
	if assignErr == nil && len(assignments) > 0 {
		// Prefer team_assignments over legacy fields
		for _, a := range assignments {
			team, err := teamRepoTx.GetByID(ctx, a.TeamID)
			if err != nil {
				if errors.Is(err, postgres.ErrNotFound) {
					slog.Warn("team not found during invite acceptance, skipping team assignment",
						"team_id", a.TeamID, "invite_id", invite.ID, "user_id", userID)
				} else {
					return nil, fmt.Errorf("look up team: %w", err)
				}
				continue
			}
			if team.IsArchived {
				slog.Warn("team is archived during invite acceptance, skipping team assignment",
					"team_id", a.TeamID, "team_name", team.Name, "invite_id", invite.ID, "user_id", userID)
				continue
			}
			tm := &domain.TeamMembership{
				ID:     uuid.New(),
				UserID: userID,
				TeamID: a.TeamID,
				Role:   a.TeamRole,
			}
			if err := teamRepoTx.CreateMembership(ctx, tm); err != nil {
				if errors.Is(err, postgres.ErrConflict) {
					// Already a team member — skip silently (idempotent)
				} else {
					return nil, fmt.Errorf("create team membership: %w", err)
				}
			}
			resultAssignments = append(resultAssignments, domain.InviteTeamAssign{
				TeamID:   a.TeamID,
				TeamRole: a.TeamRole,
				TeamName: team.Name,
			})
		}
	} else if invite.TeamID != nil {
		// Backward compat: use legacy single-team field
		team, err := teamRepoTx.GetByID(ctx, *invite.TeamID)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				slog.Warn("team not found during invite acceptance, skipping team assignment",
					"team_id", invite.TeamID, "invite_id", invite.ID, "user_id", userID)
			} else {
				return nil, fmt.Errorf("look up team: %w", err)
			}
		} else if team.IsArchived {
			slog.Warn("team is archived during invite acceptance, skipping team assignment",
				"team_id", invite.TeamID, "team_name", team.Name, "invite_id", invite.ID, "user_id", userID)
		} else {
			role := "member"
			if invite.TeamRole != nil {
				role = *invite.TeamRole
			}
			tm := &domain.TeamMembership{
				ID:     uuid.New(),
				UserID: userID,
				TeamID: *invite.TeamID,
				Role:   role,
			}
			if err := teamRepoTx.CreateMembership(ctx, tm); err != nil {
				if errors.Is(err, postgres.ErrConflict) {
					// Already a team member — skip silently (idempotent)
				} else {
					return nil, fmt.Errorf("create team membership: %w", err)
				}
			}
			resultTeamID = invite.TeamID
			resultTeamName = team.Name
			resultTeamRole = role
		}
	}

	// Auto-verify email: the user proved ownership by clicking the invite link
	if s.userRepo != nil {
		userRepoTx := s.userRepo.WithTx(tx)
		invitedUser, err := userRepoTx.GetByID(ctx, userID)
		if err == nil && !invitedUser.EmailVerified {
			invitedUser.EmailVerified = true
			if err := userRepoTx.Update(ctx, invitedUser); err != nil {
				slog.Error("failed to auto-verify email on invite acceptance", "user_id", userID, "error", err)
			} else {
				slog.Info("auto-verified email on invite acceptance", "user_id", userID, "email", userEmail)
			}
		}
	}

	if err := orgRepoTx.MarkInviteAccepted(ctx, invite.ID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	orgName := ""
	if org, err := s.orgRepo.GetByID(ctx, invite.OrgID); err == nil {
		orgName = org.Name
	}
	return &AcceptInviteResult{
		OrgID:           invite.OrgID,
		OrgName:         orgName,
		TeamID:          resultTeamID,
		TeamName:        resultTeamName,
		TeamRole:        resultTeamRole,
		TeamAssignments: resultAssignments,
	}, nil
}

func (s *OrgService) RevokeInvite(ctx context.Context, orgID, inviteID uuid.UUID) error {
	return s.orgRepo.DeleteInvite(ctx, orgID, inviteID)
}

func (s *OrgService) GetInviteByID(ctx context.Context, inviteID uuid.UUID) (*domain.Invite, error) {
	return s.orgRepo.GetInviteByID(ctx, inviteID)
}

func (s *OrgService) PreviewInvite(ctx context.Context, token string) (map[string]any, error) {
	invite, err := s.orgRepo.GetInviteByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	if invite.AcceptedAt != nil {
		return nil, fmt.Errorf("invite already accepted")
	}
	if time.Now().After(invite.ExpiresAt) {
		return nil, fmt.Errorf("invite expired")
	}
	orgName := ""
	if org, err := s.orgRepo.GetByID(ctx, invite.OrgID); err == nil {
		orgName = org.Name
	}
	result := map[string]any{
		"email":    invite.Email,
		"org_name": orgName,
		"org_role": invite.OrgRole,
	}

	// Include allowed_auth in preview
	allowedAuth := invite.AllowedAuth
	if len(allowedAuth) == 0 {
		allowedAuth = []string{"any"}
	}
	result["allowed_auth"] = allowedAuth

	// Include team assignment details
	assignments, err := s.orgRepo.GetInviteTeamAssignments(ctx, invite.ID)
	if err == nil && len(assignments) > 0 {
		result["team_assignments"] = assignments
	} else if invite.TeamID != nil {
		// Legacy single-team fallback
		team, err := s.teamRepo.GetByID(ctx, *invite.TeamID)
		if err == nil {
			result["team_name"] = team.Name
			if invite.TeamRole != nil {
				result["team_role"] = *invite.TeamRole
			}
		}
	}
	return result, nil
}

func (s *OrgService) GetMembership(ctx context.Context, userID, orgID uuid.UUID) (*domain.OrgMembership, error) {
	return s.orgRepo.GetMembership(ctx, userID, orgID)
}

func (s *OrgService) SearchMembers(ctx context.Context, orgID uuid.UUID, query string, excludeTeamID *uuid.UUID) ([]domain.OrgMemberSuggestion, error) {
	if query == "" {
		return []domain.OrgMemberSuggestion{}, nil
	}
	return s.orgRepo.SearchMembers(ctx, orgID, query, excludeTeamID, 10)
}

func (s *OrgService) ListAll(ctx context.Context, page, perPage int) ([]domain.Organization, int, error) {
	return s.orgRepo.ListAll(ctx, page, perPage)
}

func (s *OrgService) ListPendingInvites(ctx context.Context, orgID uuid.UUID) ([]domain.Invite, error) {
	invites, err := s.orgRepo.ListPendingInvites(ctx, orgID)
	if err != nil {
		return nil, err
	}

	// Enrich invites with team names
	teamNames := make(map[uuid.UUID]string)
	for i := range invites {
		if invites[i].TeamID != nil {
			tid := *invites[i].TeamID
			if _, ok := teamNames[tid]; !ok {
				team, err := s.teamRepo.GetByID(ctx, tid)
				if err == nil {
					teamNames[tid] = team.Name
				}
			}
			if name, ok := teamNames[tid]; ok {
				invites[i].TeamName = name
			}
		}
	}

	return invites, nil
}

// ── Bulk Invites ──

// BulkInviteMembers creates multiple invites in a single operation with shared configuration.
func (s *OrgService) BulkInviteMembers(ctx context.Context, orgID uuid.UUID, input domain.BulkInviteMemberInput, inviterID uuid.UUID) (*domain.BulkInviteResult, error) {
	if len(input.Emails) > 100 {
		return nil, fmt.Errorf("bulk invite request cannot exceed 100 emails")
	}

	if !rbac.ValidOrgRole(input.OrgRole) {
		return nil, fmt.Errorf("invalid org_role: %s", input.OrgRole)
	}

	// Default allowed_auth
	allowedAuth := input.AllowedAuth
	if len(allowedAuth) == 0 {
		allowedAuth = []string{"any"}
	}

	// Validate shared config once
	if err := s.validateAllowedAuth(ctx, allowedAuth); err != nil {
		return nil, err
	}
	if err := s.validateTeamAssignments(ctx, orgID, input.TeamAssignments); err != nil {
		return nil, err
	}

	result := &domain.BulkInviteResult{
		Skipped: []domain.BulkInviteSkipped{},
		Failed:  []domain.BulkInviteFailed{},
	}

	// Phase 1: Validate ALL emails upfront
	seen := make(map[string]bool)
	var validEmails []string
	for _, rawEmail := range input.Emails {
		email := strings.ToLower(strings.TrimSpace(rawEmail))
		if email == "" {
			continue // skip blank lines
		}

		// Deduplicate within the request
		if seen[email] {
			result.Skipped = append(result.Skipped, domain.BulkInviteSkipped{Email: email, Reason: "duplicate_in_request"})
			continue
		}
		seen[email] = true

		// RFC email validation
		if _, err := mail.ParseAddress(email); err != nil {
			result.Failed = append(result.Failed, domain.BulkInviteFailed{Email: email, Reason: "invalid email format"})
			continue
		}

		// Domain validation
		parts := strings.SplitN(email, "@", 2)
		if len(parts) != 2 || !emailDomainRe.MatchString(parts[1]) {
			result.Failed = append(result.Failed, domain.BulkInviteFailed{Email: email, Reason: "invalid email domain"})
			continue
		}

		// DNS check
		emailDomain := parts[1]
		if _, err := lookupMX(emailDomain); err != nil {
			if _, err := lookupHost(emailDomain); err != nil {
				result.Failed = append(result.Failed, domain.BulkInviteFailed{Email: email, Reason: fmt.Sprintf("email domain %q does not exist or has no mail server", emailDomain)})
				continue
			}
		}

		// Check if already a member
		if s.isOrgMember(ctx, orgID, email) {
			result.Skipped = append(result.Skipped, domain.BulkInviteSkipped{Email: email, Reason: "already_member"})
			continue
		}

		// Check if already has a pending invite
		if s.hasPendingInvite(ctx, orgID, email) {
			result.Skipped = append(result.Skipped, domain.BulkInviteSkipped{Email: email, Reason: "already_invited"})
			continue
		}

		validEmails = append(validEmails, email)
	}

	// Phase 2: Create all valid invites in a single transaction
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	orgRepoTx := s.orgRepo.WithTx(tx)
	var createdTokens []struct {
		email string
		token string
	}

	for _, email := range validEmails {
		// Delete any existing pending invite for this email+org
		_ = orgRepoTx.DeletePendingInviteByEmail(ctx, orgID, email)

		b := make([]byte, 32)
		rand.Read(b)
		token := hex.EncodeToString(b)

		invite := &domain.Invite{
			ID:          uuid.New(),
			OrgID:       orgID,
			Email:       email,
			OrgRole:     input.OrgRole,
			AllowedAuth: allowedAuth,
			Token:       token,
			InvitedBy:   &inviterID,
			ExpiresAt:   time.Now().Add(s.inviteExpiry),
		}

		if err := orgRepoTx.CreateInvite(ctx, invite); err != nil {
			result.Failed = append(result.Failed, domain.BulkInviteFailed{Email: email, Reason: "failed to create invite"})
			continue
		}

		if len(input.TeamAssignments) > 0 {
			if err := orgRepoTx.CreateInviteTeamAssignments(ctx, invite.ID, input.TeamAssignments); err != nil {
				result.Failed = append(result.Failed, domain.BulkInviteFailed{Email: email, Reason: "failed to create team assignments"})
				continue
			}
		}

		createdTokens = append(createdTokens, struct {
			email string
			token string
		}{email: email, token: token})
		result.Created++
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit bulk invites: %w", err)
	}

	// Phase 3: Send invite emails asynchronously
	go func() {
		orgName := ""
		if org, err := s.orgRepo.GetByID(ctx, orgID); err == nil {
			orgName = org.Name
		}
		for _, ct := range createdTokens {
			acceptURL := fmt.Sprintf("%s/invite?token=%s", s.baseURL, ct.token)
			if err := s.mailer.Send(ct.email, "You've been invited", "invite.html", map[string]string{
				"OrgName":     orgName,
				"InviterName": "A team member",
				"AcceptURL":   acceptURL,
				"ExpiresIn":   mailer.HumanDuration(s.inviteExpiry),
			}); err != nil {
				slog.Error("failed to send bulk invite email", "email", ct.email, "error", err)
			}
		}
	}()

	return result, nil
}

// ── Invite Revocation Cascade ──

// CascadeTeamInviteRevocation handles invite cleanup when a team is archived or deleted.
// It auto-revokes invites that only reference the given team, and removes the team assignment
// from invites that reference multiple teams.
func (s *OrgService) CascadeTeamInviteRevocation(ctx context.Context, teamID uuid.UUID) error {
	// Find all pending invites with team assignments referencing this team
	affectedInvites, err := s.orgRepo.FindPendingInvitesWithTeamAssignment(ctx, teamID)
	if err != nil {
		return fmt.Errorf("find affected invites: %w", err)
	}

	for _, invite := range affectedInvites {
		assignmentCount, err := s.orgRepo.CountInviteTeamAssignments(ctx, invite.ID)
		if err != nil {
			slog.Error("failed to count invite assignments", "invite_id", invite.ID, "error", err)
			continue
		}

		if assignmentCount <= 1 {
			// This invite ONLY references the archived/deleted team — auto-revoke the entire invite
			if err := s.orgRepo.DeleteInvite(ctx, invite.OrgID, invite.ID); err != nil {
				slog.Error("failed to auto-revoke invite", "invite_id", invite.ID, "error", err)
				continue
			}
			slog.Info("auto-revoked invite due to team archive/delete",
				"invite_id", invite.ID, "email", invite.Email, "team_id", teamID)
		} else {
			// Invite has multiple team assignments — remove only the assignment for this team
			if err := s.orgRepo.DeleteInviteTeamAssignment(ctx, invite.ID, teamID); err != nil {
				slog.Error("failed to remove team assignment from invite",
					"invite_id", invite.ID, "team_id", teamID, "error", err)
				continue
			}
			slog.Info("removed team assignment from invite due to team archive/delete",
				"invite_id", invite.ID, "email", invite.Email, "team_id", teamID,
				"remaining_assignments", assignmentCount-1)
		}
	}

	// Also handle legacy invites that use the old team_id column directly
	if err := s.orgRepo.RevokePendingInvitesByLegacyTeamID(ctx, teamID); err != nil {
		slog.Error("failed to revoke legacy team invites", "team_id", teamID, "error", err)
	}

	return nil
}

// ── Validation Helpers ──

// validateAllowedAuth validates the allowed_auth array values.
func (s *OrgService) validateAllowedAuth(ctx context.Context, allowedAuth []string) error {
	if len(allowedAuth) == 0 {
		return nil
	}

	hasAny := false
	for _, a := range allowedAuth {
		if a == "any" {
			hasAny = true
		}
	}

	// If "any" is present, it must be the sole element
	if hasAny && len(allowedAuth) > 1 {
		return fmt.Errorf("allowed_auth: \"any\" must be the only element when present")
	}

	if hasAny {
		return nil
	}

	var invalidValues []string
	for _, a := range allowedAuth {
		if a == "password" {
			continue
		}
		if strings.HasPrefix(a, "sso:") {
			providerName := strings.TrimPrefix(a, "sso:")
			if providerName == "" {
				invalidValues = append(invalidValues, a)
				continue
			}
			if s.ssoProviderRepo != nil {
				provider, err := s.ssoProviderRepo.GetByName(ctx, providerName)
				if err != nil {
					invalidValues = append(invalidValues, a)
					continue
				}
				if !provider.Enabled {
					invalidValues = append(invalidValues, a+" (disabled)")
					continue
				}
			}
			continue
		}
		invalidValues = append(invalidValues, a)
	}

	if len(invalidValues) > 0 {
		return fmt.Errorf("invalid allowed_auth values: %s", strings.Join(invalidValues, ", "))
	}
	return nil
}

// validateTeamAssignments validates team assignments for an invite.
func (s *OrgService) validateTeamAssignments(ctx context.Context, orgID uuid.UUID, assignments []domain.InviteTeamAssign) error {
	if len(assignments) == 0 {
		return nil
	}

	seen := make(map[uuid.UUID]bool)
	for _, a := range assignments {
		// Check for duplicate team_id
		if seen[a.TeamID] {
			return fmt.Errorf("duplicate team_id in team_assignments: %s", a.TeamID)
		}
		seen[a.TeamID] = true

		// Validate team exists and belongs to org
		team, err := s.teamRepo.GetByID(ctx, a.TeamID)
		if err != nil {
			return fmt.Errorf("team not found: %s", a.TeamID)
		}
		if team.OrgID != orgID {
			return fmt.Errorf("team %s does not belong to this organization", a.TeamID)
		}
		if team.IsArchived {
			return fmt.Errorf("team %s is archived", a.TeamID)
		}

		// Validate team_role
		role := a.TeamRole
		if role == "" {
			role = "member"
		}
		if !rbac.ValidTeamRole(role) {
			return fmt.Errorf("invalid team_role: %s", role)
		}
	}
	return nil
}

// isOrgMember checks if an email belongs to an existing org member.
func (s *OrgService) isOrgMember(ctx context.Context, orgID uuid.UUID, email string) bool {
	if s.userRepo == nil {
		return false
	}
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return false
	}
	_, err = s.orgRepo.GetMembership(ctx, user.ID, orgID)
	return err == nil
}

// hasPendingInvite checks if an email already has a pending invite for the org.
func (s *OrgService) hasPendingInvite(ctx context.Context, orgID uuid.UUID, email string) bool {
	_, err := s.orgRepo.GetPendingInviteByEmail(ctx, email)
	return err == nil
}
