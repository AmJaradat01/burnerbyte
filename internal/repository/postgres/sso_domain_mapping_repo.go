package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type SSODomainMappingRepo struct {
	db database.DBTX
}

func NewSSODomainMappingRepo(db database.DBTX) *SSODomainMappingRepo {
	return &SSODomainMappingRepo{db: db}
}

func (r *SSODomainMappingRepo) WithTx(tx database.DBTX) *SSODomainMappingRepo {
	return &SSODomainMappingRepo{db: tx}
}

func (r *SSODomainMappingRepo) Create(ctx context.Context, mapping *domain.SSODomainMapping) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO sso_domain_mappings (id, provider_id, domain, org_role, team_id, team_role)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		mapping.ID, mapping.ProviderID, mapping.Domain, mapping.OrgRole, mapping.TeamID, mapping.TeamRole)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create sso domain mapping: %w", err)
	}
	return nil
}

func (r *SSODomainMappingRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.SSODomainMapping, error) {
	var m domain.SSODomainMapping
	var teamName *string
	err := r.db.QueryRow(ctx,
		`SELECT dm.id, dm.provider_id, dm.domain, dm.org_role, dm.team_id, dm.team_role,
		        dm.created_at, dm.updated_at, t.name
		 FROM sso_domain_mappings dm
		 LEFT JOIN teams t ON dm.team_id = t.id
		 WHERE dm.id = $1`, id).
		Scan(&m.ID, &m.ProviderID, &m.Domain, &m.OrgRole, &m.TeamID, &m.TeamRole,
			&m.CreatedAt, &m.UpdatedAt, &teamName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get sso domain mapping: %w", err)
	}
	if teamName != nil {
		m.TeamName = *teamName
	}
	return &m, nil
}

func (r *SSODomainMappingRepo) ListByProvider(ctx context.Context, providerID uuid.UUID) ([]domain.SSODomainMapping, error) {
	rows, err := r.db.Query(ctx,
		`SELECT dm.id, dm.provider_id, dm.domain, dm.org_role, dm.team_id, dm.team_role,
		        dm.created_at, dm.updated_at, t.name
		 FROM sso_domain_mappings dm
		 LEFT JOIN teams t ON dm.team_id = t.id
		 WHERE dm.provider_id = $1
		 ORDER BY dm.domain, t.name`, providerID)
	if err != nil {
		return nil, fmt.Errorf("list sso domain mappings: %w", err)
	}
	defer rows.Close()

	var mappings []domain.SSODomainMapping
	for rows.Next() {
		var m domain.SSODomainMapping
		var teamName *string
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.Domain, &m.OrgRole, &m.TeamID, &m.TeamRole,
			&m.CreatedAt, &m.UpdatedAt, &teamName); err != nil {
			return nil, fmt.Errorf("scan sso domain mapping: %w", err)
		}
		if teamName != nil {
			m.TeamName = *teamName
		}
		mappings = append(mappings, m)
	}
	return mappings, rows.Err()
}

func (r *SSODomainMappingRepo) Update(ctx context.Context, mapping *domain.SSODomainMapping) error {
	_, err := r.db.Exec(ctx,
		`UPDATE sso_domain_mappings
		 SET domain = $1, org_role = $2, team_id = $3, team_role = $4, updated_at = NOW()
		 WHERE id = $5`,
		mapping.Domain, mapping.OrgRole, mapping.TeamID, mapping.TeamRole, mapping.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("update sso domain mapping: %w", err)
	}
	return nil
}

func (r *SSODomainMappingRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sso_domain_mappings WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete sso domain mapping: %w", err)
	}
	return nil
}

// FindMatchingRules returns ALL domain mapping rules that match the given provider and email domain.
// This supports multi-team domain mappings where one domain can route to multiple teams.
// Domain matching is case-insensitive and exact (no wildcards).
func (r *SSODomainMappingRepo) FindMatchingRules(ctx context.Context, providerID uuid.UUID, emailDomain string) ([]domain.SSODomainMapping, error) {
	rows, err := r.db.Query(ctx,
		`SELECT dm.id, dm.provider_id, dm.domain, dm.org_role, dm.team_id, dm.team_role,
		        dm.created_at, dm.updated_at, t.name
		 FROM sso_domain_mappings dm
		 LEFT JOIN teams t ON dm.team_id = t.id
		 WHERE dm.provider_id = $1 AND LOWER(dm.domain) = LOWER($2)
		 ORDER BY dm.domain, t.name`, providerID, emailDomain)
	if err != nil {
		return nil, fmt.Errorf("find matching domain mapping rules: %w", err)
	}
	defer rows.Close()

	var mappings []domain.SSODomainMapping
	for rows.Next() {
		var m domain.SSODomainMapping
		var teamName *string
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.Domain, &m.OrgRole, &m.TeamID, &m.TeamRole,
			&m.CreatedAt, &m.UpdatedAt, &teamName); err != nil {
			return nil, fmt.Errorf("scan matching domain mapping: %w", err)
		}
		if teamName != nil {
			m.TeamName = *teamName
		}
		mappings = append(mappings, m)
	}
	return mappings, rows.Err()
}
