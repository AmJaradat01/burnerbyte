package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth/rbac"
	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type TeamService struct {
	pool        *pgxpool.Pool
	teamRepo    *postgres.TeamRepo
	orgRepo     *postgres.OrgRepo
	userRepo    *postgres.UserRepo
	counterRepo *postgres.CounterRepo
	cfg         *config.Config
	orgSvc      *OrgService
}

func NewTeamService(pool *pgxpool.Pool, teamRepo *postgres.TeamRepo, orgRepo *postgres.OrgRepo, userRepo *postgres.UserRepo, counterRepo *postgres.CounterRepo, cfg *config.Config) *TeamService {
	return &TeamService{pool: pool, teamRepo: teamRepo, orgRepo: orgRepo, userRepo: userRepo, counterRepo: counterRepo, cfg: cfg}
}

// SetOrgService sets the OrgService reference for invite revocation cascade.
// This is called after both services are created to break the circular dependency.
func (s *TeamService) SetOrgService(orgSvc *OrgService) {
	s.orgSvc = orgSvc
}

var teamSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

func teamSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = teamSlugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "team"
	}
	return s
}

func (s *TeamService) validateAvatarURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid avatar URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("avatar URL must use http or https scheme")
	}
	return nil
}

func (s *TeamService) validateDefaultInboxTTL(ttl string, maxTTL string) error {
	d, err := time.ParseDuration(ttl)
	if err != nil {
		return fmt.Errorf("invalid default_inbox_ttl: must be a valid Go duration (e.g. \"1h\", \"24h\")")
	}
	if maxTTL != "" {
		maxD, err := time.ParseDuration(maxTTL)
		if err == nil && d > maxD {
			return fmt.Errorf("default_inbox_ttl exceeds max_inbox_ttl (%s)", maxTTL)
		}
	}
	return nil
}

func (s *TeamService) validateMaxInboxesPerDomain(n int) error {
	if n <= 0 {
		return fmt.Errorf("max_inboxes_per_domain must be a positive integer")
	}
	return nil
}

func (s *TeamService) CreateTeam(ctx context.Context, orgID uuid.UUID, input domain.CreateTeamInput, creatorID uuid.UUID) (*domain.CreateTeamResult, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if len(input.Name) > 100 {
		return nil, fmt.Errorf("name must be 100 characters or less")
	}
	if input.AvatarURL != nil && *input.AvatarURL != "" {
		if err := s.validateAvatarURL(*input.AvatarURL); err != nil {
			return nil, err
		}
	}

	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}
	maxTeams := s.cfg.RuntimeDefaults().MaxTeams
	if org.Settings.MaxTeams != nil {
		maxTeams = *org.Settings.MaxTeams
	}
	count, err := s.teamRepo.CountByOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if count >= maxTeams {
		return nil, fmt.Errorf("team limit reached (%d)", maxTeams)
	}

	slug := teamSlug(input.Name)
	team := &domain.Team{
		ID:          uuid.New(),
		OrgID:       orgID,
		Name:        input.Name,
		Slug:        slug,
		Description: input.Description,
		AvatarURL:   input.AvatarURL,
	}

	// Check if team name already exists in this org
	exists, err := s.teamRepo.ExistsByNameInOrg(ctx, orgID, input.Name)
	if err != nil {
		return nil, fmt.Errorf("check team name: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("a team named \"%s\" already exists", input.Name)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	teamRepoTx := s.teamRepo.WithTx(tx)
	if err := teamRepoTx.Create(ctx, team); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			tx.Rollback(ctx) //nolint:errcheck
			b := make([]byte, 3)
			if _, err := rand.Read(b); err != nil {
				return nil, fmt.Errorf("generate slug: %w", err)
			}
			team.Slug = slug + "-" + hex.EncodeToString(b)
			tx2, err := s.pool.Begin(ctx)
			if err != nil {
				return nil, err
			}
			defer tx2.Rollback(ctx) //nolint:errcheck
			teamRepoTx2 := s.teamRepo.WithTx(tx2)
			if err := teamRepoTx2.Create(ctx, team); err != nil {
				return nil, fmt.Errorf("team slug conflict: %w", err)
			}
			membership := &domain.TeamMembership{ID: uuid.New(), UserID: creatorID, TeamID: team.ID, Role: rbac.TeamLead}
			if err := teamRepoTx2.CreateMembership(ctx, membership); err != nil {
				return nil, err
			}
			// Add initial members
			failedMembers := s.addInitialMembers(ctx, teamRepoTx2, team.ID, creatorID, input.Members)
			// Assign initial domains
			failedDomains, assignedCount := s.assignInitialDomains(ctx, tx2, team.ID, orgID, input.Domains)
			if err := tx2.Commit(ctx); err != nil {
				return nil, err
			}
			return &domain.CreateTeamResult{Team: team, FailedMembers: failedMembers, FailedDomains: failedDomains, AssignedDomains: assignedCount}, nil
		}
		return nil, err
	}

	membership := &domain.TeamMembership{ID: uuid.New(), UserID: creatorID, TeamID: team.ID, Role: rbac.TeamLead}
	if err := teamRepoTx.CreateMembership(ctx, membership); err != nil {
		return nil, err
	}

	// Add initial members
	failedMembers := s.addInitialMembers(ctx, teamRepoTx, team.ID, creatorID, input.Members)

	// Assign initial domains
	failedDomains, assignedCount := s.assignInitialDomains(ctx, tx, team.ID, orgID, input.Domains)

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &domain.CreateTeamResult{Team: team, FailedMembers: failedMembers, FailedDomains: failedDomains, AssignedDomains: assignedCount}, nil
}

func (s *TeamService) addInitialMembers(ctx context.Context, repo *postgres.TeamRepo, teamID, creatorID uuid.UUID, members []domain.AddTeamMemberInput) []domain.BulkMemberFailed {
	var failed []domain.BulkMemberFailed
	for _, m := range members {
		if !rbac.ValidTeamRole(m.Role) {
			identifier := m.Email
			if identifier == "" {
				identifier = m.UserID
			}
			failed = append(failed, domain.BulkMemberFailed{Identifier: identifier, Reason: fmt.Sprintf("invalid role: %s", m.Role)})
			continue
		}
		userID, identifier, err := s.resolveUser(ctx, m)
		if err != nil {
			failed = append(failed, domain.BulkMemberFailed{Identifier: identifier, Reason: err.Error()})
			continue
		}
		// Skip if creator already added
		if userID == creatorID {
			continue
		}
		mem := &domain.TeamMembership{ID: uuid.New(), UserID: userID, TeamID: teamID, Role: m.Role}
		if err := repo.CreateMembership(ctx, mem); err != nil {
			if errors.Is(err, postgres.ErrConflict) {
				continue // already a member, skip silently
			}
			failed = append(failed, domain.BulkMemberFailed{Identifier: identifier, Reason: "failed to add member"})
		}
	}
	return failed
}

func (s *TeamService) assignInitialDomains(ctx context.Context, tx pgx.Tx, teamID, orgID uuid.UUID, domains []domain.CreateTeamDomainInput) ([]domain.BulkDomainFailed, int) {
	var failed []domain.BulkDomainFailed
	assigned := 0
	for _, d := range domains {
		domainID, err := uuid.Parse(d.DomainID)
		if err != nil {
			failed = append(failed, domain.BulkDomainFailed{DomainID: d.DomainID, Reason: "invalid domain ID"})
			continue
		}
		accessLevel := d.AccessLevel
		if accessLevel == "" {
			accessLevel = "full"
		}
		if accessLevel != "full" && accessLevel != "create_inbox" && accessLevel != "read_only" {
			failed = append(failed, domain.BulkDomainFailed{DomainID: d.DomainID, Reason: "invalid access_level"})
			continue
		}
		// Verify domain belongs to this org
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM domains WHERE id = $1 AND org_id = $2)`, domainID, orgID).Scan(&exists)
		if err != nil || !exists {
			failed = append(failed, domain.BulkDomainFailed{DomainID: d.DomainID, Reason: "domain not found in this organization"})
			continue
		}
		assignmentID := uuid.New()
		_, err = tx.Exec(ctx,
			`INSERT INTO domain_assignments (id, team_id, domain_id, access_level) VALUES ($1, $2, $3, $4)`,
			assignmentID, teamID, domainID, accessLevel)
		if err != nil {
			failed = append(failed, domain.BulkDomainFailed{DomainID: d.DomainID, Reason: "failed to assign domain"})
			continue
		}
		assigned++
	}
	return failed, assigned
}

func (s *TeamService) resolveUser(ctx context.Context, input domain.AddTeamMemberInput) (uuid.UUID, string, error) {
	if input.Email != "" {
		user, err := s.userRepo.GetByEmail(ctx, strings.TrimSpace(input.Email))
		if err != nil {
			return uuid.Nil, input.Email, fmt.Errorf("user not found with email: %s", input.Email)
		}
		return user.ID, input.Email, nil
	}
	if input.UserID != "" {
		uid, err := uuid.Parse(input.UserID)
		if err != nil {
			return uuid.Nil, input.UserID, fmt.Errorf("invalid user_id")
		}
		return uid, input.UserID, nil
	}
	return uuid.Nil, "", fmt.Errorf("email or user_id is required")
}

func (s *TeamService) GetTeam(ctx context.Context, orgID, id uuid.UUID) (*domain.Team, error) {
	t, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if t.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	return t, nil
}

func (s *TeamService) GetTeamDetail(ctx context.Context, orgID, id uuid.UUID) (*domain.TeamDetail, error) {
	td, err := s.teamRepo.GetDetail(ctx, id)
	if err != nil {
		return nil, err
	}
	if td.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	// Fetch total_emails_received from counter repo
	if s.counterRepo != nil {
		totalEmails, err := s.counterRepo.GetTeamCounters(ctx, id)
		if err != nil {
			slog.Warn("failed to fetch team counters", "team_id", id, "error", err)
		}
		td.TotalEmailsReceived = totalEmails
	}
	return td, nil
}

func (s *TeamService) ListByOrg(ctx context.Context, orgID uuid.UUID, opts postgres.ListTeamsOpts) ([]domain.Team, int, error) {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 || opts.PerPage > 100 {
		opts.PerPage = 20
	}
	// Default to non-archived when not specified
	if opts.IsArchived == nil {
		f := false
		opts.IsArchived = &f
	}
	return s.teamRepo.ListByOrg(ctx, orgID, opts)
}

func (s *TeamService) ListByUserMembership(ctx context.Context, orgID, userID uuid.UUID, opts postgres.ListTeamsOpts) ([]domain.Team, int, error) {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 || opts.PerPage > 100 {
		opts.PerPage = 20
	}
	if opts.IsArchived == nil {
		f := false
		opts.IsArchived = &f
	}
	return s.teamRepo.ListByUserMembership(ctx, orgID, userID, opts)
}

func (s *TeamService) UpdateTeam(ctx context.Context, orgID, id uuid.UUID, input domain.UpdateTeamInput) (*domain.Team, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	if team.IsArchived {
		return nil, fmt.Errorf("cannot update an archived team")
	}
	if input.Name != nil {
		team.Name = *input.Name
		team.Slug = teamSlug(*input.Name)
	}
	if input.Description != nil {
		team.Description = input.Description
	}
	if input.AvatarURL != nil {
		if *input.AvatarURL != "" {
			if err := s.validateAvatarURL(*input.AvatarURL); err != nil {
				return nil, err
			}
		}
		team.AvatarURL = input.AvatarURL
	}
	if input.Settings != nil {
		if input.Settings.AttachmentsEnabled != nil {
			team.Settings.AttachmentsEnabled = input.Settings.AttachmentsEnabled
		}
		if input.Settings.MaxInboxTTL != nil {
			team.Settings.MaxInboxTTL = input.Settings.MaxInboxTTL
		}
		if input.Settings.DefaultInboxTTL != nil {
			maxTTL := ""
			if team.Settings.MaxInboxTTL != nil {
				maxTTL = *team.Settings.MaxInboxTTL
			}
			if input.Settings.MaxInboxTTL != nil {
				maxTTL = *input.Settings.MaxInboxTTL
			}
			if err := s.validateDefaultInboxTTL(*input.Settings.DefaultInboxTTL, maxTTL); err != nil {
				return nil, err
			}
			team.Settings.DefaultInboxTTL = input.Settings.DefaultInboxTTL
		}
		if input.Settings.MaxInboxesPerDomain != nil {
			if err := s.validateMaxInboxesPerDomain(*input.Settings.MaxInboxesPerDomain); err != nil {
				return nil, err
			}
			team.Settings.MaxInboxesPerDomain = input.Settings.MaxInboxesPerDomain
		}
	}
	if err := s.teamRepo.Update(ctx, team); err != nil {
		return nil, err
	}
	return team, nil
}

func (s *TeamService) DeleteTeam(ctx context.Context, orgID, id uuid.UUID) error {
	t, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if t.OrgID != orgID {
		return fmt.Errorf("team not found")
	}
	// Cascade invite revocation before delete (for audit logging and partial assignment removal)
	if s.orgSvc != nil {
		if err := s.orgSvc.CascadeTeamInviteRevocation(ctx, id); err != nil {
			slog.Warn("failed to cascade invite revocation on team delete", "team_id", id, "error", err)
		}
	}
	return s.teamRepo.Delete(ctx, id)
}

func (s *TeamService) ArchiveTeam(ctx context.Context, orgID, id uuid.UUID) (*domain.Team, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	if team.IsArchived {
		return nil, fmt.Errorf("team is already archived")
	}
	if err := s.teamRepo.SetArchived(ctx, id, true); err != nil {
		return nil, err
	}
	// Cascade invite revocation after archiving
	if s.orgSvc != nil {
		if err := s.orgSvc.CascadeTeamInviteRevocation(ctx, id); err != nil {
			slog.Warn("failed to cascade invite revocation on team archive", "team_id", id, "error", err)
		}
	}
	return s.teamRepo.GetByID(ctx, id)
}

func (s *TeamService) RestoreTeam(ctx context.Context, orgID, id uuid.UUID) (*domain.Team, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	if !team.IsArchived {
		return nil, fmt.Errorf("team is not archived")
	}
	if err := s.teamRepo.SetArchived(ctx, id, false); err != nil {
		return nil, err
	}
	return s.teamRepo.GetByID(ctx, id)
}

func (s *TeamService) GetImpact(ctx context.Context, orgID, id uuid.UUID) (*domain.TeamImpact, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, postgres.ErrNotFound
	}
	return s.teamRepo.GetImpact(ctx, id)
}

func (s *TeamService) LeaveTeam(ctx context.Context, orgID, teamID, userID uuid.UUID) error {
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return err
	}
	if team.OrgID != orgID {
		return fmt.Errorf("team not found")
	}
	membership, err := s.teamRepo.GetMembership(ctx, userID, teamID)
	if err != nil {
		return fmt.Errorf("not a member of this team")
	}
	// Last-lead protection
	if membership.Role == rbac.TeamLead {
		leadCount, err := s.teamRepo.CountLeads(ctx, teamID)
		if err != nil {
			return err
		}
		if leadCount <= 1 {
			return fmt.Errorf("cannot leave: you are the last lead of this team")
		}
	}
	return s.teamRepo.DeleteMembership(ctx, userID, teamID)
}

func (s *TeamService) BulkAddMembers(ctx context.Context, teamID uuid.UUID, members []domain.AddTeamMemberInput) (*domain.BulkMemberResult, error) {
	if len(members) > 100 {
		return nil, fmt.Errorf("maximum 100 members per bulk operation")
	}

	// Check if team is archived
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if team.IsArchived {
		return nil, fmt.Errorf("cannot add members to an archived team")
	}

	result := &domain.BulkMemberResult{
		Skipped: []domain.BulkMemberSkipped{},
	}
	for _, m := range members {
		identifier := m.Email
		if identifier == "" {
			identifier = m.UserID
		}
		if !rbac.ValidTeamRole(m.Role) {
			result.Failed = append(result.Failed, domain.BulkMemberFailed{Identifier: identifier, Reason: fmt.Sprintf("invalid role: %s", m.Role)})
			continue
		}
		userID, ident, err := s.resolveUser(ctx, m)
		if err != nil {
			result.Failed = append(result.Failed, domain.BulkMemberFailed{Identifier: ident, Reason: err.Error()})
			continue
		}
		mem := &domain.TeamMembership{ID: uuid.New(), UserID: userID, TeamID: teamID, Role: m.Role}
		if err := s.teamRepo.CreateMembership(ctx, mem); err != nil {
			if errors.Is(err, postgres.ErrConflict) {
				result.Skipped = append(result.Skipped, domain.BulkMemberSkipped{Identifier: ident, Reason: "already a member"})
				continue
			}
			result.Failed = append(result.Failed, domain.BulkMemberFailed{Identifier: ident, Reason: "failed to add member"})
			continue
		}
		result.AddedCount++
	}
	return result, nil
}

func (s *TeamService) BulkRemoveMembers(ctx context.Context, teamID uuid.UUID, userIDs []uuid.UUID) (*domain.BulkMemberResult, error) {
	if len(userIDs) > 100 {
		return nil, fmt.Errorf("maximum 100 members per bulk operation")
	}

	// Check if team is archived
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if team.IsArchived {
		return nil, fmt.Errorf("cannot modify an archived team")
	}

	result := &domain.BulkMemberResult{
		Skipped: []domain.BulkMemberSkipped{},
	}

	// Single pass: look up each membership, classify as skipped/removable,
	// and count leads that would be removed.
	leadCount, err := s.teamRepo.CountLeads(ctx, teamID)
	if err != nil {
		return nil, err
	}

	type memberEntry struct {
		uid  uuid.UUID
		role string
	}
	var toRemove []memberEntry
	leadsToRemove := 0

	for _, uid := range userIDs {
		m, err := s.teamRepo.GetMembership(ctx, uid, teamID)
		if err != nil {
			result.Skipped = append(result.Skipped, domain.BulkMemberSkipped{Identifier: uid.String(), Reason: "not a member"})
			continue
		}
		if m.Role == rbac.TeamLead {
			leadsToRemove++
		}
		toRemove = append(toRemove, memberEntry{uid: uid, role: m.Role})
	}

	// Pre-check: reject entire request if it would leave zero leads
	if leadCount-leadsToRemove <= 0 {
		return nil, fmt.Errorf("cannot remove: would leave the team with zero leads")
	}

	// Execute removals
	for _, entry := range toRemove {
		if err := s.teamRepo.DeleteMembership(ctx, entry.uid, teamID); err != nil {
			result.Failed = append(result.Failed, domain.BulkMemberFailed{Identifier: entry.uid.String(), Reason: "failed to remove"})
			continue
		}
		result.RemovedCount++
	}
	return result, nil
}

func (s *TeamService) AddMember(ctx context.Context, teamID uuid.UUID, input domain.AddTeamMemberInput) error {
	// Check if team is archived
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return err
	}
	if team.IsArchived {
		return fmt.Errorf("cannot add members to an archived team")
	}

	if !rbac.ValidTeamRole(input.Role) {
		return fmt.Errorf("invalid role: %s", input.Role)
	}

	userID, _, err := s.resolveUser(ctx, input)
	if err != nil {
		return err
	}

	m := &domain.TeamMembership{ID: uuid.New(), UserID: userID, TeamID: teamID, Role: input.Role}
	if err := s.teamRepo.CreateMembership(ctx, m); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return fmt.Errorf("user already a member")
		}
		return err
	}
	return nil
}

func (s *TeamService) ListMembers(ctx context.Context, teamID uuid.UUID, opts postgres.ListMembersOpts) ([]domain.TeamMembership, int, error) {
	return s.teamRepo.ListMembersFiltered(ctx, teamID, opts)
}

func (s *TeamService) ChangeRole(ctx context.Context, teamID, userID uuid.UUID, role string) error {
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return err
	}
	if team.IsArchived {
		return fmt.Errorf("cannot modify an archived team")
	}

	if !rbac.ValidTeamRole(role) {
		return fmt.Errorf("invalid role: %s", role)
	}
	// Last-lead protection: if changing from lead to non-lead
	current, err := s.teamRepo.GetMembership(ctx, userID, teamID)
	if err != nil {
		return err
	}
	if current.Role == rbac.TeamLead && role != rbac.TeamLead {
		leadCount, err := s.teamRepo.CountLeads(ctx, teamID)
		if err != nil {
			return err
		}
		if leadCount <= 1 {
			return fmt.Errorf("cannot change role: this is the last lead of the team")
		}
	}
	return s.teamRepo.UpdateMemberRole(ctx, userID, teamID, role)
}

func (s *TeamService) RemoveMember(ctx context.Context, teamID, userID uuid.UUID) error {
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return err
	}
	if team.IsArchived {
		return fmt.Errorf("cannot modify an archived team")
	}
	// Last-lead protection
	membership, err := s.teamRepo.GetMembership(ctx, userID, teamID)
	if err != nil {
		return fmt.Errorf("not a member of this team")
	}
	if membership.Role == rbac.TeamLead {
		leadCount, err := s.teamRepo.CountLeads(ctx, teamID)
		if err != nil {
			return err
		}
		if leadCount <= 1 {
			return fmt.Errorf("cannot remove the last team lead")
		}
	}
	return s.teamRepo.DeleteMembership(ctx, userID, teamID)
}

func (s *TeamService) GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error) {
	return s.teamRepo.GetMembership(ctx, userID, teamID)
}

func (s *TeamService) TransferTeam(ctx context.Context, orgID, teamID, targetOrgID uuid.UUID) (*domain.TransferTeamResult, error) {
	team, err := s.teamRepo.GetByID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, fmt.Errorf("team not found in this organization")
	}
	if team.IsArchived {
		return nil, fmt.Errorf("cannot transfer an archived team")
	}

	// Validate target org exists
	targetOrg, err := s.orgRepo.GetByID(ctx, targetOrgID)
	if err != nil {
		return nil, fmt.Errorf("target organization not found")
	}

	// Check team limit on target org
	maxTeams := s.cfg.RuntimeDefaults().MaxTeams
	if targetOrg.Settings.MaxTeams != nil {
		maxTeams = *targetOrg.Settings.MaxTeams
	}
	targetCount, err := s.teamRepo.CountByOrg(ctx, targetOrgID)
	if err != nil {
		return nil, err
	}
	if targetCount >= maxTeams {
		return nil, fmt.Errorf("target organization has reached its team limit (%d)", maxTeams)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	teamRepoTx := s.teamRepo.WithTx(tx)

	// Remove all domain assignments
	if err := teamRepoTx.RemoveDomainAssignments(ctx, teamID); err != nil {
		return nil, err
	}

	// Check each member is in target org
	memberIDs, err := teamRepoTx.ListMemberUserIDs(ctx, teamID)
	if err != nil {
		return nil, err
	}

	orgRepoTx := s.orgRepo.WithTx(tx)
	var removedMembers []domain.TransferRemoved
	var removeIDs []uuid.UUID
	for _, uid := range memberIDs {
		_, err := orgRepoTx.GetMembership(ctx, uid, targetOrgID)
		if err != nil {
			// Not in target org — remove from team
			email := ""
			displayName := ""
			if userInfo, uErr := s.userRepo.GetByID(ctx, uid); uErr == nil && userInfo != nil {
				email = userInfo.Email
				displayName = userInfo.DisplayName
			}
			removedMembers = append(removedMembers, domain.TransferRemoved{
				UserID:      uid,
				Email:       email,
				DisplayName: displayName,
			})
			removeIDs = append(removeIDs, uid)
		}
	}

	if len(removeIDs) > 0 {
		if err := teamRepoTx.BulkDeleteMemberships(ctx, teamID, removeIDs); err != nil {
			return nil, err
		}
	}

	// Update team org_id
	_, err = tx.Exec(ctx, `UPDATE teams SET org_id = $1 WHERE id = $2`, targetOrgID, teamID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Fetch updated team
	updatedTeam, _ := s.teamRepo.GetByID(ctx, teamID)
	return &domain.TransferTeamResult{
		Team:           updatedTeam,
		RemovedMembers: removedMembers,
	}, nil
}
