package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type TeamRepo struct {
	db database.DBTX
}

func NewTeamRepo(db database.DBTX) *TeamRepo {
	return &TeamRepo{db: db}
}

func (r *TeamRepo) WithTx(tx database.DBTX) *TeamRepo {
	return &TeamRepo{db: tx}
}

func (r *TeamRepo) Create(ctx context.Context, t *domain.Team) error {
	settings, _ := json.Marshal(t.Settings)
	_, err := r.db.Exec(ctx,
		`INSERT INTO teams (id, org_id, name, slug, settings) VALUES ($1, $2, $3, $4, $5)`,
		t.ID, t.OrgID, t.Name, t.Slug, settings)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create team: %w", err)
	}
	return nil
}

func (r *TeamRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Team, error) {
	var t domain.Team
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT id, org_id, name, slug, settings, created_at, updated_at FROM teams WHERE id = $1`, id).
		Scan(&t.ID, &t.OrgID, &t.Name, &t.Slug, &settings, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(settings, &t.Settings)
	return &t, nil
}

func (r *TeamRepo) ListByOrg(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.Team, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT t.id, t.org_id, t.name, t.slug, t.settings, t.created_at, t.updated_at,
		        (SELECT COUNT(*) FROM team_memberships tm WHERE tm.team_id = t.id),
		        (SELECT COUNT(DISTINCT da.domain_id) FROM domain_assignments da WHERE da.team_id = t.id),
		        (SELECT COUNT(*) FROM inboxes i JOIN domain_assignments da ON i.domain_assignment_id = da.id WHERE da.team_id = t.id AND i.is_active = TRUE)
		 FROM teams t WHERE t.org_id = $1 ORDER BY t.name LIMIT $2 OFFSET $3`, orgID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var teams []domain.Team
	for rows.Next() {
		var t domain.Team
		var settings []byte
		if err := rows.Scan(&t.ID, &t.OrgID, &t.Name, &t.Slug, &settings, &t.CreatedAt, &t.UpdatedAt,
			&t.MemberCount, &t.DomainCount, &t.ActiveInboxes); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(settings, &t.Settings)
		teams = append(teams, t)
	}
	return teams, total, nil
}

func (r *TeamRepo) Update(ctx context.Context, t *domain.Team) error {
	settings, _ := json.Marshal(t.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE teams SET name=$1, slug=$2, settings=$3 WHERE id=$4`,
		t.Name, t.Slug, settings, t.ID)
	return err
}

func (r *TeamRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM teams WHERE id = $1`, id)
	return err
}

func (r *TeamRepo) CountByOrg(ctx context.Context, orgID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM teams WHERE org_id = $1`, orgID).Scan(&count)
	return count, err
}

// ── Team Memberships ──

func (r *TeamRepo) CreateMembership(ctx context.Context, m *domain.TeamMembership) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO team_memberships (id, user_id, team_id, role) VALUES ($1, $2, $3, $4)`,
		m.ID, m.UserID, m.TeamID, m.Role)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create team membership: %w", err)
	}
	return nil
}

func (r *TeamRepo) GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error) {
	var m domain.TeamMembership
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, team_id, role, created_at FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
		userID, teamID).Scan(&m.ID, &m.UserID, &m.TeamID, &m.Role, &m.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *TeamRepo) ListMembers(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.TeamMembership, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM team_memberships WHERE team_id = $1`, teamID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT tm.id, tm.user_id, tm.team_id, tm.role, tm.created_at, u.email, u.display_name
		 FROM team_memberships tm JOIN users u ON tm.user_id = u.id
		 WHERE tm.team_id = $1 ORDER BY tm.created_at LIMIT $2 OFFSET $3`, teamID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var members []domain.TeamMembership
	for rows.Next() {
		var m domain.TeamMembership
		if err := rows.Scan(&m.ID, &m.UserID, &m.TeamID, &m.Role, &m.CreatedAt, &m.Email, &m.DisplayName); err != nil {
			return nil, 0, err
		}
		members = append(members, m)
	}
	return members, total, nil
}

func (r *TeamRepo) UpdateMemberRole(ctx context.Context, userID, teamID uuid.UUID, role string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE team_memberships SET role = $1 WHERE user_id = $2 AND team_id = $3`, role, userID, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *TeamRepo) DeleteMembership(ctx context.Context, userID, teamID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM team_memberships WHERE user_id = $1 AND team_id = $2`, userID, teamID)
	return err
}
