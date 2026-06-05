package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

type InboxRepo struct {
	db database.DBTX
}

func NewInboxRepo(db database.DBTX) *InboxRepo {
	return &InboxRepo{db: db}
}

func (r *InboxRepo) WithTx(tx database.DBTX) *InboxRepo {
	return &InboxRepo{db: tx}
}

func (r *InboxRepo) Create(ctx context.Context, i *domain.Inbox) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO inboxes (id, domain_assignment_id, domain_id, created_by, address, full_address, is_active, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		i.ID, i.DomainAssignmentID, i.DomainID, i.CreatedBy, i.Address, i.FullAddress, i.IsActive, i.ExpiresAt)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return fmt.Errorf("create inbox: %w", err)
	}
	return nil
}

func (r *InboxRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.Inbox, error) {
	var i domain.Inbox
	err := r.db.QueryRow(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        (i.is_active AND i.expires_at > NOW()), i.expires_at, i.created_at, d.domain_name, d.org_id
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id WHERE i.id = $1`, id).
		Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName, &i.OrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &i, nil
}

func (r *InboxRepo) GetByFullAddress(ctx context.Context, addr string) (*domain.Inbox, error) {
	var i domain.Inbox
	err := r.db.QueryRow(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        (i.is_active AND i.expires_at > NOW()), i.expires_at, i.created_at, d.domain_name, d.org_id
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id
		 WHERE i.full_address = $1 AND i.is_active = TRUE AND i.expires_at > NOW()`, addr).
		Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName, &i.OrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &i, nil
}

func (r *InboxRepo) ListByUserWithStatus(ctx context.Context, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	return r.listByUser(ctx, userID, status, page, perPage)
}

func (r *InboxRepo) listByUser(ctx context.Context, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	statusFilter := statusClause(status)

	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i JOIN domains d ON i.domain_id = d.id WHERE i.created_by = $1`+statusFilter, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        (i.is_active AND i.expires_at > NOW()), i.expires_at, i.created_at, d.domain_name,
		        (SELECT COUNT(*) FROM emails e WHERE e.inbox_id = i.id),
		        (SELECT COUNT(*) FROM emails e WHERE e.inbox_id = i.id AND e.is_read = FALSE)
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id
		 WHERE i.created_by = $1`+statusFilter+`
		 ORDER BY i.created_at DESC LIMIT $2 OFFSET $3`, userID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName, &i.EmailCount, &i.UnreadCount); err != nil {
			return nil, 0, err
		}
		inboxes = append(inboxes, i)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return inboxes, total, nil
}

func statusClause(status string) string {
	switch status {
	case "expired":
		return " AND (is_active = FALSE OR expires_at <= NOW())"
	case "all":
		return ""
	default:
		return " AND is_active = TRUE AND expires_at > NOW()"
	}
}

func (r *InboxRepo) ListByTeamWithStatus(ctx context.Context, teamID, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	return r.listByTeam(ctx, teamID, userID, status, page, perPage)
}

func (r *InboxRepo) listByTeam(ctx context.Context, teamID, userID uuid.UUID, status string, page, perPage int) ([]domain.Inbox, int, error) {
	sf := statusClause(status)

	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.created_by = $2`+sf, teamID, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        (i.is_active AND i.expires_at > NOW()), i.expires_at, i.created_at, d.domain_name,
		        (SELECT COUNT(*) FROM emails e WHERE e.inbox_id = i.id),
		        (SELECT COUNT(*) FROM emails e WHERE e.inbox_id = i.id AND e.is_read = FALSE)
		 FROM inboxes i
		 JOIN domains d ON i.domain_id = d.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.created_by = $2`+sf+`
		 ORDER BY i.created_at DESC LIMIT $3 OFFSET $4`, teamID, userID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName, &i.EmailCount, &i.UnreadCount); err != nil {
			return nil, 0, err
		}
		inboxes = append(inboxes, i)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return inboxes, total, nil
}

func (r *InboxRepo) ExtendTTL(ctx context.Context, id uuid.UUID, newExpiry time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE inboxes SET expires_at = $1 WHERE id = $2`, newExpiry, id)
	return err
}

func (r *InboxRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `DELETE FROM inboxes WHERE id = $1`, id)
	return err
}

func (r *InboxRepo) Deactivate(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.Exec(ctx, `UPDATE inboxes SET is_active = FALSE WHERE id = $1`, id)
	return err
}

func (r *InboxRepo) CountActiveByAssignment(ctx context.Context, assignmentID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes WHERE domain_assignment_id = $1 AND is_active = TRUE AND expires_at > NOW()`, assignmentID).Scan(&count)
	return count, err
}

func (r *InboxRepo) CountActiveByDomain(ctx context.Context, domainID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes WHERE domain_id = $1 AND is_active = TRUE AND expires_at > NOW()`, domainID).Scan(&count)
	return count, err
}

func (r *InboxRepo) CountActiveByUser(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes WHERE created_by = $1 AND is_active = TRUE AND expires_at > NOW()`, userID).Scan(&count)
	return count, err
}

func (r *InboxRepo) ListActiveAddressesByDomain(ctx context.Context, domainID uuid.UUID) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT i.address || '@' || d.domain_name FROM inboxes i
		 JOIN domains d ON i.domain_id = d.id
		 WHERE i.domain_id = $1 AND i.is_active = TRUE AND i.expires_at > NOW()`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var addresses []string
	for rows.Next() {
		var addr string
		if err := rows.Scan(&addr); err != nil { return nil, err }
		addresses = append(addresses, addr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return addresses, nil
}

// DomainInboxImpact holds an active inbox with its creator email and email count.
type DomainInboxImpact struct {
	ID             uuid.UUID `json:"id"`
	Address        string    `json:"address"`
	FullAddress    string    `json:"full_address"`
	IsActive       bool      `json:"is_active"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
	DomainName     string    `json:"domain_name"`
	CreatedByEmail string    `json:"created_by_email"`
	EmailCount     int       `json:"email_count"`
}

func (r *InboxRepo) ListActiveByDomain(ctx context.Context, domainID uuid.UUID) ([]DomainInboxImpact, error) {
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.address, i.full_address, i.is_active, i.expires_at, i.created_at,
		        d.domain_name, u.email as created_by_email,
		        (SELECT COUNT(*) FROM emails e WHERE e.inbox_id = i.id) as email_count
		 FROM inboxes i
		 JOIN domains d ON i.domain_id = d.id
		 JOIN users u ON i.created_by = u.id
		 WHERE i.domain_id = $1 AND i.is_active = TRUE AND i.expires_at > NOW()
		 ORDER BY i.created_at DESC`, domainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []DomainInboxImpact
	for rows.Next() {
		var item DomainInboxImpact
		if err := rows.Scan(&item.ID, &item.Address, &item.FullAddress, &item.IsActive, &item.ExpiresAt, &item.CreatedAt,
			&item.DomainName, &item.CreatedByEmail, &item.EmailCount); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *InboxRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM inboxes WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ListExpired returns inboxes whose TTL has elapsed, joined to their org and
// team, so the cleanup worker can emit inbox.expired events before the rows are
// removed. The assignment join is a LEFT JOIN so an inbox is still returned
// (with a zero team) even if its assignment was already deleted.
func (r *InboxRepo) ListExpired(ctx context.Context) ([]domain.Inbox, error) {
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        i.expires_at, i.created_at, d.domain_name, d.org_id,
		        COALESCE(da.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
		 FROM inboxes i
		 JOIN domains d ON i.domain_id = d.id
		 LEFT JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE i.expires_at < NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.ExpiresAt, &i.CreatedAt, &i.DomainName, &i.OrgID, &i.TeamID); err != nil {
			return nil, err
		}
		inboxes = append(inboxes, i)
	}
	return inboxes, rows.Err()
}

func (r *InboxRepo) ListActive(ctx context.Context) ([]domain.Inbox, error) {
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        i.is_active, i.expires_at, i.created_at, d.domain_name
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id
		 WHERE i.is_active = TRUE AND i.expires_at > NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName); err != nil {
			return nil, err
		}
		inboxes = append(inboxes, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return inboxes, nil
}
