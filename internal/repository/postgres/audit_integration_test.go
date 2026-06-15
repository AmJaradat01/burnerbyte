package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// Core fix: platform-level audit events (no owning org) are recorded with
// OrgID = uuid.Nil. Previously this violated audit_logs.org_id NOT NULL + FK
// and the row silently failed to persist. After migration 000044 + the repo
// writing NULL for uuid.Nil, the event persists.
func TestIntegration_AuditOrglessEventPersists(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewAuditRepo(pool)

	id := uuid.New()
	err := repo.Create(ctx, &domain.AuditEntry{
		ID:           id,
		OrgID:        uuid.Nil, // platform-level event (e.g. user.registered, user.login)
		Action:       "user.registered",
		ResourceType: "user",
		ResourceID:   uuid.New(),
		Metadata:     map[string]any{"email": "persist@corp.com"},
		Severity:     "info",
	})
	if err != nil {
		t.Fatalf("recording an org-less audit event must succeed, got: %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_logs WHERE id = $1 AND org_id IS NULL`, id).Scan(&n); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if n != 1 {
		t.Errorf("org-less audit event not persisted with NULL org_id (count=%d)", n)
	}
}

// Regression: org-scoped events still persist with their org_id intact and are
// returned by the org-scoped List query.
func TestIntegration_AuditOrgScopedEventPersists(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewAuditRepo(pool)
	orgID := seedOrg(t, pool)

	err := repo.Create(ctx, &domain.AuditEntry{
		ID:           uuid.New(),
		OrgID:        orgID,
		Action:       "domain.created",
		ResourceType: "domain",
		ResourceID:   uuid.New(),
		Metadata:     map[string]any{"domain": "example.com"},
		Severity:     "info",
		Category:     "domain",
	})
	if err != nil {
		t.Fatalf("record org-scoped audit: %v", err)
	}

	entries, total, err := repo.List(ctx, orgID, domain.AuditFilter{}, 1, 20)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(entries) != 1 || entries[0].OrgID != orgID {
		t.Errorf("expected one org-scoped entry for the org, got total=%d len=%d", total, len(entries))
	}
}
