package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type DomainRepo struct {
	db database.DBTX
}

func NewDomainRepo(db database.DBTX) *DomainRepo {
	return &DomainRepo{db: db}
}

func (r *DomainRepo) WithTx(tx database.DBTX) *DomainRepo {
	return &DomainRepo{db: tx}
}

func (r *DomainRepo) Create(ctx context.Context, d *domain.Domain) error {
	settings, _ := json.Marshal(d.Settings)
	_, err := r.db.Exec(ctx,
		`INSERT INTO domains (id, org_id, domain_name, settings) VALUES ($1, $2, $3, $4)`,
		d.ID, d.OrgID, d.DomainName, settings)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create domain: %w", err)
	}
	return nil
}

func (r *DomainRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Domain, error) {
	return r.scanOne(ctx,
		`SELECT id, org_id, domain_name, mx_verified, txt_verified, dns_last_checked_at, settings, created_at, updated_at
		 FROM domains WHERE id = $1`, id)
}

func (r *DomainRepo) GetByName(ctx context.Context, name string) (*domain.Domain, error) {
	return r.scanOne(ctx,
		`SELECT id, org_id, domain_name, mx_verified, txt_verified, dns_last_checked_at, settings, created_at, updated_at
		 FROM domains WHERE domain_name = $1`, name)
}

func (r *DomainRepo) ListByOrg(ctx context.Context, orgID uuid.UUID, page, perPage int) ([]domain.Domain, int, error) {
	var total int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains WHERE org_id = $1`, orgID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, domain_name, mx_verified, txt_verified, dns_last_checked_at, settings, created_at, updated_at
		 FROM domains WHERE org_id = $1 ORDER BY domain_name LIMIT $2 OFFSET $3`, orgID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var domains []domain.Domain
	for rows.Next() {
		d, err := r.scanRow(rows)
		if err != nil {
			return nil, 0, err
		}
		domains = append(domains, *d)
	}
	return domains, total, nil
}

func (r *DomainRepo) Update(ctx context.Context, d *domain.Domain) error {
	settings, _ := json.Marshal(d.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE domains SET domain_name=$1, settings=$2 WHERE id=$3`,
		d.DomainName, settings, d.ID)
	return err
}

func (r *DomainRepo) UpdateDNSStatus(ctx context.Context, id uuid.UUID, mx, txt bool) error {
	_, err := r.db.Exec(ctx,
		`UPDATE domains SET mx_verified=$1, txt_verified=$2, dns_last_checked_at=NOW() WHERE id=$3`,
		mx, txt, id)
	return err
}

func (r *DomainRepo) ListAll(ctx context.Context) ([]domain.Domain, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, domain_name, mx_verified, txt_verified, dns_last_checked_at, settings, created_at, updated_at FROM domains`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var domains []domain.Domain
	for rows.Next() {
		d, err := r.scanRow(rows)
		if err != nil {
			return nil, err
		}
		domains = append(domains, *d)
	}
	return domains, nil
}

func (r *DomainRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM domains WHERE id = $1`, id)
	return err
}

func (r *DomainRepo) CountByOrg(ctx context.Context, orgID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains WHERE org_id = $1`, orgID).Scan(&count)
	return count, err
}

func (r *DomainRepo) scanOne(ctx context.Context, query string, args ...any) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&d.ID, &d.OrgID, &d.DomainName, &d.MXVerified, &d.TXTVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	json.Unmarshal(settings, &d.Settings)
	return &d, nil
}

func (r *DomainRepo) scanRow(rows pgx.Rows) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	err := rows.Scan(&d.ID, &d.OrgID, &d.DomainName, &d.MXVerified, &d.TXTVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(settings, &d.Settings)
	return &d, nil
}
