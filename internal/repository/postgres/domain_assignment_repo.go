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

type DomainAssignmentRepo struct {
	db database.DBTX
}

func NewDomainAssignmentRepo(db database.DBTX) *DomainAssignmentRepo {
	return &DomainAssignmentRepo{db: db}
}

func (r *DomainAssignmentRepo) WithTx(tx database.DBTX) *DomainAssignmentRepo {
	return &DomainAssignmentRepo{db: tx}
}

func (r *DomainAssignmentRepo) Create(ctx context.Context, a *domain.DomainAssignment) error {
	settings, _ := json.Marshal(a.Settings)
	_, err := r.db.Exec(ctx,
		`INSERT INTO domain_assignments (id, team_id, domain_id, access_level, settings, assigned_by)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		a.ID, a.TeamID, a.DomainID, a.AccessLevel, settings, a.AssignedBy)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create assignment: %w", err)
	}
	return nil
}

func (r *DomainAssignmentRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.DomainAssignment, error) {
	var a domain.DomainAssignment
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT da.id, da.team_id, da.domain_id, da.access_level, da.settings, da.assigned_by,
		        da.created_at, da.updated_at, d.domain_name
		 FROM domain_assignments da JOIN domains d ON da.domain_id = d.id
		 WHERE da.id = $1`, id).
		Scan(&a.ID, &a.TeamID, &a.DomainID, &a.AccessLevel, &settings, &a.AssignedBy,
			&a.CreatedAt, &a.UpdatedAt, &a.DomainName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(settings, &a.Settings)
	return &a, nil
}

func (r *DomainAssignmentRepo) GetByTeamAndDomain(ctx context.Context, teamID, domainID uuid.UUID) (*domain.DomainAssignment, error) {
	var a domain.DomainAssignment
	var settings []byte
	err := r.db.QueryRow(ctx,
		`SELECT da.id, da.team_id, da.domain_id, da.access_level, da.settings, da.assigned_by,
		        da.created_at, da.updated_at, d.domain_name
		 FROM domain_assignments da JOIN domains d ON da.domain_id = d.id
		 WHERE da.team_id = $1 AND da.domain_id = $2`, teamID, domainID).
		Scan(&a.ID, &a.TeamID, &a.DomainID, &a.AccessLevel, &settings, &a.AssignedBy,
			&a.CreatedAt, &a.UpdatedAt, &a.DomainName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(settings, &a.Settings)
	return &a, nil
}

func (r *DomainAssignmentRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.DomainAssignment, error) {
	rows, err := r.db.Query(ctx,
		`SELECT da.id, da.team_id, da.domain_id, da.access_level, da.settings, da.assigned_by,
		        da.created_at, da.updated_at, d.domain_name
		 FROM domain_assignments da
		 JOIN domains d ON da.domain_id = d.id
		 JOIN team_memberships tm ON tm.team_id = da.team_id
		 WHERE tm.user_id = $1 AND da.access_level IN ('full','create_inbox')
		   AND d.mx_verified = TRUE
		 ORDER BY d.domain_name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DomainAssignment
	for rows.Next() {
		var a domain.DomainAssignment
		var settings []byte
		if err := rows.Scan(&a.ID, &a.TeamID, &a.DomainID, &a.AccessLevel, &settings, &a.AssignedBy,
			&a.CreatedAt, &a.UpdatedAt, &a.DomainName); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(settings, &a.Settings)
		out = append(out, a)
	}
	return out, nil
}

func (r *DomainAssignmentRepo) ListByTeam(ctx context.Context, teamID uuid.UUID, page, perPage int) ([]domain.DomainAssignment, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domain_assignments WHERE team_id = $1`, teamID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT da.id, da.team_id, da.domain_id, da.access_level, da.settings, da.assigned_by,
		        da.created_at, da.updated_at, d.domain_name
		 FROM domain_assignments da JOIN domains d ON da.domain_id = d.id
		 WHERE da.team_id = $1 ORDER BY d.domain_name LIMIT $2 OFFSET $3`, teamID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var assignments []domain.DomainAssignment
	for rows.Next() {
		var a domain.DomainAssignment
		var settings []byte
		if err := rows.Scan(&a.ID, &a.TeamID, &a.DomainID, &a.AccessLevel, &settings, &a.AssignedBy,
			&a.CreatedAt, &a.UpdatedAt, &a.DomainName); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(settings, &a.Settings)
		assignments = append(assignments, a)
	}
	return assignments, total, nil
}

func (r *DomainAssignmentRepo) Update(ctx context.Context, a *domain.DomainAssignment) error {
	settings, _ := json.Marshal(a.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE domain_assignments SET access_level=$1, settings=$2 WHERE id=$3`,
		a.AccessLevel, settings, a.ID)
	return err
}

func (r *DomainAssignmentRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM domain_assignments WHERE id = $1`, id)
	return err
}
