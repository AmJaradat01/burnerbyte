package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

type TeamService struct {
	pool     *pgxpool.Pool
	teamRepo *postgres.TeamRepo
	orgRepo  *postgres.OrgRepo
	cfg      *config.Config
}

func NewTeamService(pool *pgxpool.Pool, teamRepo *postgres.TeamRepo, orgRepo *postgres.OrgRepo, cfg *config.Config) *TeamService {
	return &TeamService{pool: pool, teamRepo: teamRepo, orgRepo: orgRepo, cfg: cfg}
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

func (s *TeamService) CreateTeam(ctx context.Context, orgID uuid.UUID, input domain.CreateTeamInput, creatorID uuid.UUID) (*domain.Team, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	org, err := s.orgRepo.GetByID(ctx, orgID)
	if err != nil {
		return nil, err
	}
	maxTeams := s.cfg.Defaults.MaxTeams
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
	team := &domain.Team{ID: uuid.New(), OrgID: orgID, Name: input.Name, Slug: slug}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	teamRepoTx := s.teamRepo.WithTx(tx)
	if err := teamRepoTx.Create(ctx, team); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			b := make([]byte, 3)
			rand.Read(b)
			team.Slug = slug + "-" + hex.EncodeToString(b)
			if err := teamRepoTx.Create(ctx, team); err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	membership := &domain.TeamMembership{ID: uuid.New(), UserID: creatorID, TeamID: team.ID, Role: "lead"}
	if err := teamRepoTx.CreateMembership(ctx, membership); err != nil {
		return nil, err
	}

	return team, tx.Commit(ctx)
}

func (s *TeamService) GetTeam(ctx context.Context, orgID, id uuid.UUID) (*domain.Team, error) {
	t, err := s.teamRepo.GetByID(ctx, id)
	if err != nil { return nil, err }
	if t.OrgID != orgID { return nil, fmt.Errorf("team not found") }
	return t, nil
}

func (s *TeamService) ListByOrg(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.Team, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.teamRepo.ListByOrg(ctx, orgID, page, perPage)
}

func (s *TeamService) UpdateTeam(ctx context.Context, orgID, id uuid.UUID, input domain.UpdateTeamInput) (*domain.Team, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if team.OrgID != orgID {
		return nil, fmt.Errorf("team not found")
	}
	if input.Name != nil {
		team.Name = *input.Name
		team.Slug = teamSlug(*input.Name)
	}
	if input.Settings != nil {
		if input.Settings.AttachmentsEnabled != nil {
			team.Settings.AttachmentsEnabled = input.Settings.AttachmentsEnabled
		}
		if input.Settings.MaxInboxTTL != nil {
			team.Settings.MaxInboxTTL = input.Settings.MaxInboxTTL
		}
	}
	if err := s.teamRepo.Update(ctx, team); err != nil {
		return nil, err
	}
	return team, nil
}

func (s *TeamService) DeleteTeam(ctx context.Context, orgID, id uuid.UUID) error {
	t, err := s.teamRepo.GetByID(ctx, id)
	if err != nil { return err }
	if t.OrgID != orgID { return fmt.Errorf("team not found") }
	return s.teamRepo.Delete(ctx, id)
}

func (s *TeamService) AddMember(ctx context.Context, teamID uuid.UUID, input domain.AddTeamMemberInput) error {
	if input.Role != "lead" && input.Role != "member" && input.Role != "viewer" {
		return fmt.Errorf("invalid role: %s", input.Role)
	}
	userID, err := uuid.Parse(input.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id")
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

func (s *TeamService) ListMembers(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.TeamMembership, int, error) {
	if page < 1 { page = 1 }
	if perPage < 1 || perPage > 100 { perPage = 20 }
	return s.teamRepo.ListMembers(ctx, teamID, page, perPage)
}

func (s *TeamService) ChangeRole(ctx context.Context, teamID, userID uuid.UUID, role string) error {
	if role != "lead" && role != "member" && role != "viewer" {
		return fmt.Errorf("invalid role: %s", role)
	}
	return s.teamRepo.UpdateMemberRole(ctx, userID, teamID, role)
}

func (s *TeamService) RemoveMember(ctx context.Context, teamID, userID uuid.UUID) error {
	return s.teamRepo.DeleteMembership(ctx, userID, teamID)
}

func (s *TeamService) GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error) {
	return s.teamRepo.GetMembership(ctx, userID, teamID)
}
