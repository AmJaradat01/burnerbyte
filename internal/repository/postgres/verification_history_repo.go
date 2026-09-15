package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/amjaradat01/burnerbyte/internal/database"
	"github.com/amjaradat01/burnerbyte/internal/domain"
)

type VerificationHistoryRepo struct {
	db database.DBTX
}

func NewVerificationHistoryRepo(db database.DBTX) *VerificationHistoryRepo {
	return &VerificationHistoryRepo{db: db}
}

func (r *VerificationHistoryRepo) Create(ctx context.Context, record *domain.VerificationHistory) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO domain_verification_history (id, domain_id, checked_at, mx_result, txt_result, spf_result, trigger_source, error_details)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		record.ID, record.DomainID, record.CheckedAt, record.MXResult, record.TXTResult, record.SPFResult, record.TriggerSource, record.ErrorDetails)
	return err
}

func (r *VerificationHistoryRepo) ListByDomain(ctx context.Context, domainID uuid.UUID, page, perPage int) ([]domain.VerificationHistory, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM domain_verification_history WHERE domain_id = $1`, domainID).Scan(&total)
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

	rows, err := r.db.Query(ctx,
		`SELECT id, domain_id, checked_at, mx_result, txt_result, spf_result, trigger_source, error_details
		 FROM domain_verification_history
		 WHERE domain_id = $1
		 ORDER BY checked_at DESC
		 LIMIT $2 OFFSET $3`, domainID, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var records []domain.VerificationHistory
	for rows.Next() {
		var h domain.VerificationHistory
		if err := rows.Scan(&h.ID, &h.DomainID, &h.CheckedAt, &h.MXResult, &h.TXTResult, &h.SPFResult, &h.TriggerSource, &h.ErrorDetails); err != nil {
			return nil, 0, err
		}
		records = append(records, h)
	}
	return records, total, nil
}
