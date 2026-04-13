package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/database"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
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
		`INSERT INTO audit_logs (id, org_id, actor_id, action, resource_type, resource_id, metadata, ip_address, user_agent, resource_name, actor_display_name, severity, category)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::inet,$9,$10,$11,$12,$13)`,
		e.ID, e.OrgID, e.ActorID, e.Action, e.ResourceType, e.ResourceID, metadata, e.IPAddress,
		e.UserAgent, e.ResourceName, e.ActorDisplayName, e.Severity, e.Category)
	if err != nil {
		return fmt.Errorf("create audit: %w", err)
	}
	return nil
}

func (r *AuditRepo) List(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter, page, perPage int) ([]domain.AuditEntry, int, error) {
	query := `SELECT a.id, a.org_id, a.actor_id, COALESCE(u.email,''), a.action, a.resource_type, a.resource_id, a.metadata, host(a.ip_address), a.created_at, COALESCE(a.user_agent,''), COALESCE(a.resource_name,''), COALESCE(a.actor_display_name,''), COALESCE(a.severity,'info'), COALESCE(a.category,'') FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id WHERE a.org_id = $1`
	countQuery := `SELECT COUNT(*) FROM audit_logs a WHERE a.org_id = $1`
	args := []any{orgID}
	idx := 2

	if filter.ActorID != nil {
		query += fmt.Sprintf(` AND a.actor_id = $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.actor_id = $%d`, idx)
		args = append(args, *filter.ActorID)
		idx++
	}
	if filter.Action != nil {
		query += fmt.Sprintf(` AND a.action LIKE $%d || '%%'`, idx)
		countQuery += fmt.Sprintf(` AND a.action LIKE $%d || '%%'`, idx)
		args = append(args, *filter.Action)
		idx++
	}
	if filter.ResourceType != nil {
		query += fmt.Sprintf(` AND a.resource_type = $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.resource_type = $%d`, idx)
		args = append(args, *filter.ResourceType)
		idx++
	}
	if filter.DateFrom != nil {
		query += fmt.Sprintf(` AND a.created_at >= $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.created_at >= $%d`, idx)
		args = append(args, *filter.DateFrom)
		idx++
	}
	if filter.DateTo != nil {
		query += fmt.Sprintf(` AND a.created_at <= $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.created_at <= $%d`, idx)
		args = append(args, *filter.DateTo)
		idx++
	}
	if filter.Severity != nil {
		query += fmt.Sprintf(` AND a.severity = $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.severity = $%d`, idx)
		args = append(args, *filter.Severity)
		idx++
	}
	if filter.Category != nil {
		query += fmt.Sprintf(` AND a.category = $%d`, idx)
		countQuery += fmt.Sprintf(` AND a.category = $%d`, idx)
		args = append(args, *filter.Category)
		idx++
	}
	if filter.ResourceName != nil {
		query += fmt.Sprintf(` AND a.resource_name ILIKE '%%' || $%d || '%%'`, idx)
		countQuery += fmt.Sprintf(` AND a.resource_name ILIKE '%%' || $%d || '%%'`, idx)
		args = append(args, *filter.ResourceName)
		idx++
	}

	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	query += fmt.Sprintf(` ORDER BY a.created_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, perPage, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []domain.AuditEntry
	for rows.Next() {
		var e domain.AuditEntry
		var metadata []byte
		if err := rows.Scan(&e.ID, &e.OrgID, &e.ActorID, &e.ActorEmail, &e.Action, &e.ResourceType, &e.ResourceID, &metadata, &e.IPAddress, &e.CreatedAt, &e.UserAgent, &e.ResourceName, &e.ActorDisplayName, &e.Severity, &e.Category); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal(metadata, &e.Metadata)
		entries = append(entries, e)
	}
	return entries, total, nil
}

// ListAll returns up to 10,000 audit entries matching the filters without pagination (for export).
func (r *AuditRepo) ListAll(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter) ([]domain.AuditEntry, error) {
	const maxExportRows = 10000

	query := `SELECT a.id, a.org_id, a.actor_id, COALESCE(u.email,''), a.action, a.resource_type, a.resource_id, a.metadata, host(a.ip_address), a.created_at, COALESCE(a.user_agent,''), COALESCE(a.resource_name,''), COALESCE(a.actor_display_name,''), COALESCE(a.severity,'info'), COALESCE(a.category,'') FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id WHERE a.org_id = $1`
	args := []any{orgID}
	idx := 2

	if filter.ActorID != nil {
		query += fmt.Sprintf(` AND a.actor_id = $%d`, idx)
		args = append(args, *filter.ActorID)
		idx++
	}
	if filter.Action != nil {
		query += fmt.Sprintf(` AND a.action LIKE $%d || '%%'`, idx)
		args = append(args, *filter.Action)
		idx++
	}
	if filter.ResourceType != nil {
		query += fmt.Sprintf(` AND a.resource_type = $%d`, idx)
		args = append(args, *filter.ResourceType)
		idx++
	}
	if filter.DateFrom != nil {
		query += fmt.Sprintf(` AND a.created_at >= $%d`, idx)
		args = append(args, *filter.DateFrom)
		idx++
	}
	if filter.DateTo != nil {
		query += fmt.Sprintf(` AND a.created_at <= $%d`, idx)
		args = append(args, *filter.DateTo)
		idx++
	}
	if filter.Severity != nil {
		query += fmt.Sprintf(` AND a.severity = $%d`, idx)
		args = append(args, *filter.Severity)
		idx++
	}
	if filter.Category != nil {
		query += fmt.Sprintf(` AND a.category = $%d`, idx)
		args = append(args, *filter.Category)
		idx++
	}
	if filter.ResourceName != nil {
		query += fmt.Sprintf(` AND a.resource_name ILIKE '%%' || $%d || '%%'`, idx)
		args = append(args, *filter.ResourceName)
		idx++
	}

	query += fmt.Sprintf(` ORDER BY a.created_at DESC LIMIT $%d`, idx)
	args = append(args, maxExportRows)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []domain.AuditEntry
	for rows.Next() {
		var e domain.AuditEntry
		var metadata []byte
		if err := rows.Scan(&e.ID, &e.OrgID, &e.ActorID, &e.ActorEmail, &e.Action, &e.ResourceType, &e.ResourceID, &metadata, &e.IPAddress, &e.CreatedAt, &e.UserAgent, &e.ResourceName, &e.ActorDisplayName, &e.Severity, &e.Category); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(metadata, &e.Metadata)
		entries = append(entries, e)
	}
	return entries, nil
}
