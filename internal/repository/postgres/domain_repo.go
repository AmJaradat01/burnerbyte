package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
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
		`INSERT INTO domains (id, org_id, domain_name, description, settings) VALUES ($1, $2, $3, $4, $5)`,
		d.ID, d.OrgID, d.DomainName, d.Description, settings)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create domain: %w", err)
	}
	return nil
}

func (r *DomainRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	var description *string
	err := r.db.QueryRow(ctx,
		`SELECT d.id, d.org_id, d.domain_name, d.description, d.mx_verified, d.txt_verified, d.spf_verified,
		        d.dns_last_checked_at, d.settings, d.created_at, d.updated_at,
		        d.inboxes_created_count,
		        (SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id AND i.is_active = TRUE),
		        (SELECT COUNT(DISTINCT da.team_id) FROM domain_assignments da WHERE da.domain_id = d.id)
		 FROM domains d WHERE d.id = $1`, id).Scan(
		&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt,
		&d.InboxesCreatedCount, &d.ActiveInboxes, &d.TeamCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if description != nil {
		d.Description = *description
	}
	_ = json.Unmarshal(settings, &d.Settings)
	return &d, nil
}

func (r *DomainRepo) GetByIDEnriched(ctx context.Context, id uuid.UUID) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	var description *string
	var emailsReceived *int
	err := r.db.QueryRow(ctx,
		`SELECT d.id, d.org_id, d.domain_name, d.description, d.mx_verified, d.txt_verified, d.spf_verified,
		        d.dns_last_checked_at, d.settings, d.created_at, d.updated_at,
		        d.inboxes_created_count,
		        (SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id AND i.is_active = TRUE),
		        (SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id),
		        (SELECT COALESCE(SUM(sub.cnt), 0) FROM (SELECT COUNT(*) as cnt FROM emails e JOIN inboxes i ON e.inbox_id = i.id WHERE i.domain_id = d.id) sub),
		        (SELECT COUNT(DISTINCT da.team_id) FROM domain_assignments da WHERE da.domain_id = d.id),
		        (SELECT COALESCE(SUM(ddes.emails_received), 0) FROM daily_domain_email_stats ddes WHERE ddes.org_id = d.org_id AND ddes.domain_name = d.domain_name)
		 FROM domains d WHERE d.id = $1`, id).Scan(
		&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt,
		&d.InboxesCreatedCount, &d.ActiveInboxes, &d.TotalInboxes, &d.TotalEmails, &d.TeamCount, &emailsReceived)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if description != nil {
		d.Description = *description
	}
	if emailsReceived != nil {
		d.EmailsReceivedCount = *emailsReceived
	}
	_ = json.Unmarshal(settings, &d.Settings)

	// Load assignments with team names
	rows, err := r.db.Query(ctx,
		`SELECT da.team_id, t.name, da.access_level
		 FROM domain_assignments da
		 JOIN teams t ON da.team_id = t.id
		 WHERE da.domain_id = $1
		 ORDER BY t.name`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var a domain.DomainAssignmentSummary
			if err := rows.Scan(&a.TeamID, &a.TeamName, &a.AccessLevel); err == nil {
				d.Assignments = append(d.Assignments, a)
			}
		}
	}

	return &d, nil
}

func (r *DomainRepo) GetByName(ctx context.Context, name string) (*domain.Domain, error) {
	return r.scanOne(ctx,
		`SELECT id, org_id, domain_name, description, mx_verified, txt_verified, spf_verified, dns_last_checked_at, settings, created_at, updated_at
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
		`SELECT d.id, d.org_id, d.domain_name, d.description, d.mx_verified, d.txt_verified, d.spf_verified,
		        d.dns_last_checked_at, d.settings, d.created_at, d.updated_at,
		        d.inboxes_created_count,
		        (SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id AND i.is_active = TRUE),
		        (SELECT COUNT(DISTINCT da.team_id) FROM domain_assignments da WHERE da.domain_id = d.id)
		 FROM domains d WHERE d.org_id = $1 ORDER BY d.domain_name LIMIT $2 OFFSET $3`, orgID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var domains []domain.Domain
	for rows.Next() {
		var d domain.Domain
		var settings []byte
		var description *string
		err := rows.Scan(&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
			&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt, &d.InboxesCreatedCount, &d.ActiveInboxes, &d.TeamCount)
		if err != nil {
			return nil, 0, err
		}
		if description != nil {
			d.Description = *description
		}
		_ = json.Unmarshal(settings, &d.Settings)
		domains = append(domains, d)
	}
	return domains, total, nil
}

func (r *DomainRepo) ListByOrgFiltered(ctx context.Context, orgID uuid.UUID, filter domain.DomainListFilter, page, perPage int) ([]domain.Domain, int, error) {
	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("d.org_id = $%d", argIdx))
	args = append(args, orgID)
	argIdx++

	if filter.Search != "" {
		conditions = append(conditions, fmt.Sprintf("d.domain_name ILIKE $%d", argIdx))
		args = append(args, "%"+filter.Search+"%")
		argIdx++
	}

	switch filter.Status {
	case "verified":
		conditions = append(conditions, "d.mx_verified = TRUE AND d.txt_verified = TRUE")
	case "pending_verification":
		conditions = append(conditions, "d.mx_verified = FALSE AND d.txt_verified = FALSE AND d.dns_last_checked_at IS NULL")
	case "partially_verified":
		conditions = append(conditions, "((d.mx_verified = TRUE AND d.txt_verified = FALSE) OR (d.mx_verified = FALSE AND d.txt_verified = TRUE))")
	case "failed":
		conditions = append(conditions, "d.mx_verified = FALSE AND d.txt_verified = FALSE AND d.dns_last_checked_at IS NOT NULL")
	}

	where := "WHERE " + strings.Join(conditions, " AND ")

	// Count
	var total int
	countQuery := "SELECT COUNT(*) FROM domains d " + where
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	offset := (page - 1) * perPage

	listArgs := append(args, perPage, offset)
	listQuery := fmt.Sprintf(
		`SELECT d.id, d.org_id, d.domain_name, d.description, d.mx_verified, d.txt_verified, d.spf_verified,
		        d.dns_last_checked_at, d.settings, d.created_at, d.updated_at,
		        d.inboxes_created_count,
		        (SELECT COUNT(*) FROM inboxes i WHERE i.domain_id = d.id AND i.is_active = TRUE),
		        (SELECT COUNT(DISTINCT da.team_id) FROM domain_assignments da WHERE da.domain_id = d.id)
		 FROM domains d %s ORDER BY d.domain_name LIMIT $%d OFFSET $%d`,
		where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, listQuery, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var domains []domain.Domain
	for rows.Next() {
		var d domain.Domain
		var settings []byte
		var description *string
		err := rows.Scan(&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
			&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt, &d.InboxesCreatedCount, &d.ActiveInboxes, &d.TeamCount)
		if err != nil {
			return nil, 0, err
		}
		if description != nil {
			d.Description = *description
		}
		_ = json.Unmarshal(settings, &d.Settings)
		domains = append(domains, d)
	}
	return domains, total, nil
}

func (r *DomainRepo) Update(ctx context.Context, d *domain.Domain) error {
	settings, _ := json.Marshal(d.Settings)
	_, err := r.db.Exec(ctx,
		`UPDATE domains SET domain_name=$1, description=$2, settings=$3 WHERE id=$4`,
		d.DomainName, d.Description, settings, d.ID)
	return err
}

func (r *DomainRepo) UpdateDNSStatus(ctx context.Context, id uuid.UUID, mx, txt, spf bool) error {
	_, err := r.db.Exec(ctx,
		`UPDATE domains SET mx_verified=$1, txt_verified=$2, spf_verified=$3, dns_last_checked_at=NOW() WHERE id=$4`,
		mx, txt, spf, id)
	return err
}

func (r *DomainRepo) UpdateOrgID(ctx context.Context, domainID, newOrgID uuid.UUID) error {
	_, err := r.db.Exec(ctx,
		`UPDATE domains SET org_id = $1 WHERE id = $2`, newOrgID, domainID)
	return err
}

func (r *DomainRepo) ListAll(ctx context.Context) ([]domain.Domain, error) {
	return r.listAllInternal(ctx, 0, 0)
}

func (r *DomainRepo) ListByPage(ctx context.Context, page, perPage int) ([]domain.Domain, int, error) {
	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM domains`).Scan(&total); err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 500 {
		perPage = 100
	}
	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, domain_name, description, mx_verified, txt_verified, spf_verified, dns_last_checked_at, settings, created_at, updated_at
		 FROM domains ORDER BY created_at LIMIT $1 OFFSET $2`, perPage, offset)
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

func (r *DomainRepo) listAllInternal(ctx context.Context, limit, offset int) ([]domain.Domain, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, org_id, domain_name, description, mx_verified, txt_verified, spf_verified, dns_last_checked_at, settings, created_at, updated_at FROM domains`)
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

func (r *DomainRepo) IncrementInboxCount(ctx context.Context, domainID uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE domains SET inboxes_created_count = inboxes_created_count + 1 WHERE id = $1`, domainID)
	return err
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

func (r *DomainRepo) DeleteAssignmentsByDomain(ctx context.Context, domainID uuid.UUID) (int, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM domain_assignments WHERE domain_id = $1`, domainID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (r *DomainRepo) DeactivateInboxesByDomain(ctx context.Context, domainID uuid.UUID) (int, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE inboxes SET is_active = FALSE WHERE domain_id = $1 AND is_active = TRUE`, domainID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (r *DomainRepo) scanOne(ctx context.Context, query string, args ...any) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	var description *string
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if description != nil {
		d.Description = *description
	}
	_ = json.Unmarshal(settings, &d.Settings)
	return &d, nil
}

func (r *DomainRepo) scanRow(rows pgx.Rows) (*domain.Domain, error) {
	var d domain.Domain
	var settings []byte
	var description *string
	err := rows.Scan(&d.ID, &d.OrgID, &d.DomainName, &description, &d.MXVerified, &d.TXTVerified, &d.SPFVerified,
		&d.DNSLastCheckedAt, &settings, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if description != nil {
		d.Description = *description
	}
	_ = json.Unmarshal(settings, &d.Settings)
	return &d, nil
}
