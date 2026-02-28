package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
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
		        i.is_active, i.expires_at, i.created_at, d.domain_name
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id WHERE i.id = $1`, id).
		Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName)
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
		        i.is_active, i.expires_at, i.created_at, d.domain_name
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id
		 WHERE i.full_address = $1 AND i.is_active = TRUE`, addr).
		Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &i, nil
}

func (r *InboxRepo) ListByUser(ctx context.Context, userID uuid.UUID, page, perPage int) ([]domain.Inbox, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes WHERE created_by = $1 AND is_active = TRUE`, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        i.is_active, i.expires_at, i.created_at, d.domain_name
		 FROM inboxes i JOIN domains d ON i.domain_id = d.id
		 WHERE i.created_by = $1 AND i.is_active = TRUE
		 ORDER BY i.created_at DESC LIMIT $2 OFFSET $3`, userID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName); err != nil {
			return nil, 0, err
		}
		inboxes = append(inboxes, i)
	}
	return inboxes, total, nil
}

func (r *InboxRepo) ListByTeam(ctx context.Context, teamID, userID uuid.UUID, page, perPage int) ([]domain.Inbox, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes i
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.created_by = $2 AND i.is_active = TRUE`, teamID, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	rows, err := r.db.Query(ctx,
		`SELECT i.id, i.domain_assignment_id, i.domain_id, i.created_by, i.address, i.full_address,
		        i.is_active, i.expires_at, i.created_at, d.domain_name
		 FROM inboxes i
		 JOIN domains d ON i.domain_id = d.id
		 JOIN domain_assignments da ON i.domain_assignment_id = da.id
		 WHERE da.team_id = $1 AND i.created_by = $2 AND i.is_active = TRUE
		 ORDER BY i.created_at DESC LIMIT $3 OFFSET $4`, teamID, userID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var inboxes []domain.Inbox
	for rows.Next() {
		var i domain.Inbox
		if err := rows.Scan(&i.ID, &i.DomainAssignmentID, &i.DomainID, &i.CreatedBy, &i.Address, &i.FullAddress,
			&i.IsActive, &i.ExpiresAt, &i.CreatedAt, &i.DomainName); err != nil {
			return nil, 0, err
		}
		inboxes = append(inboxes, i)
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

func (r *InboxRepo) CountActiveByDomain(ctx context.Context, domainID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM inboxes WHERE domain_id = $1 AND is_active = TRUE`, domainID).Scan(&count)
	return count, err
}

func (r *InboxRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM inboxes WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
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
	return inboxes, nil
}
