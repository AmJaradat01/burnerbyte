package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/amjaradat01/burnerbyte/internal/database"
	"gitlab.com/amjaradat01/burnerbyte/internal/domain"
)

type AuditRepo struct {
	db database.DBTX
}

func NewAuditRepo(db database.DBTX) *AuditRepo {
	return &AuditRepo{db: db}
}

func (r *AuditRepo) Create(ctx context.Context, e *domain.AuditEntry) error {
	metadata, _ := json.Marshal(e.Metadata)
	_, err := r.db.Exec(ctx,
		`INSERT INTO audit_logs (id, org_id, actor_id, action, resource_type, resource_id, metadata, ip_address)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::inet)`,
		e.ID, e.OrgID, e.ActorID, e.Action, e.ResourceType, e.ResourceID, metadata, e.IPAddress)
	if err != nil { return fmt.Errorf("create audit: %w", err) }
	return nil
}

func (r *AuditRepo) List(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter, page, perPage int) ([]domain.AuditEntry, int, error) {
	query := `SELECT id, org_id, actor_id, action, resource_type, resource_id, metadata, ip_address::text, created_at FROM audit_logs WHERE org_id = $1`
	countQuery := `SELECT COUNT(*) FROM audit_logs WHERE org_id = $1`
	args := []any{orgID}
	idx := 2

	if filter.ActorID != nil {
		query += fmt.Sprintf(` AND actor_id = $%d`, idx)
		countQuery += fmt.Sprintf(` AND actor_id = $%d`, idx)
		args = append(args, *filter.ActorID)
		idx++
	}
	if filter.Action != nil {
		query += fmt.Sprintf(` AND action = $%d`, idx)
		countQuery += fmt.Sprintf(` AND action = $%d`, idx)
		args = append(args, *filter.Action)
		idx++
	}
	if filter.ResourceType != nil {
		query += fmt.Sprintf(` AND resource_type = $%d`, idx)
		countQuery += fmt.Sprintf(` AND resource_type = $%d`, idx)
		args = append(args, *filter.ResourceType)
		idx++
	}
	if filter.DateFrom != nil {
		query += fmt.Sprintf(` AND created_at >= $%d`, idx)
		countQuery += fmt.Sprintf(` AND created_at >= $%d`, idx)
		args = append(args, *filter.DateFrom)
		idx++
	}
	if filter.DateTo != nil {
		query += fmt.Sprintf(` AND created_at <= $%d`, idx)
		countQuery += fmt.Sprintf(` AND created_at <= $%d`, idx)
		args = append(args, *filter.DateTo)
		idx++
	}

	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	query += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, perPage, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil { return nil, 0, err }
	defer rows.Close()

	var entries []domain.AuditEntry
	for rows.Next() {
		var e domain.AuditEntry
		var metadata []byte
		if err := rows.Scan(&e.ID, &e.OrgID, &e.ActorID, &e.Action, &e.ResourceType, &e.ResourceID, &metadata, &e.IPAddress, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(metadata, &e.Metadata)
		entries = append(entries, e)
	}
	return entries, total, nil
}
