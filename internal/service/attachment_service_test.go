package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/amjaradat01/burnerbyte/internal/config"
	"github.com/amjaradat01/burnerbyte/internal/repository/postgres"
)

// newAttachmentSvcWithOwner builds an AttachmentService whose mocked database
// resolves any storage-key lookup to an attachment -> email -> inbox chain where
// the inbox is owned by inboxOwner. s3 is nil because AuthorizeKeyAccess never
// touches storage.
func newAttachmentSvcWithOwner(inboxOwner uuid.UUID) *AttachmentService {
	now := time.Now()
	emailID := uuid.New()
	inboxID := uuid.New()

	db := &mockDBTX{
		queryRowHandler: func(sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "storage_key = $1"):
				// AttachmentRepo.GetByStorageKey: id, email_id, filename,
				// content_type, size_bytes, storage_key, created_at
				return &mockRow{values: []any{
					uuid.New(), emailID, "file.pdf", "application/pdf",
					int64(1234), "attachments/x/y/file.pdf", now,
				}}
			case strings.Contains(sql, "FROM emails"):
				// EmailRepo.GetByID (15 cols).
				return &mockRow{values: []any{
					emailID, inboxID, nil, "from@a.com", "to@b.com", nil, nil, nil,
					true, any(nil), int64(1234), float32(0), false, now, now,
				}}
			case strings.Contains(sql, "inboxes i JOIN domains"):
				// InboxRepo.GetByID (12 cols); created_by at index 3 is the owner.
				return &mockRow{values: []any{
					inboxID, uuid.New(), uuid.New(), inboxOwner, "addr", "addr@b.com",
					true, now, now, (*string)(nil), "b.com", uuid.New(),
				}}
			default:
				return &mockRow{err: pgx.ErrNoRows}
			}
		},
	}

	return NewAttachmentService(
		postgres.NewAttachmentRepo(db),
		postgres.NewEmailRepo(db),
		postgres.NewInboxRepo(db),
		nil, // ObjectStorage unused by AuthorizeKeyAccess
		config.MinIOConfig{Bucket: "burnerbyte"},
		25,
		15*time.Minute,
	)
}

// TestAttachmentAuthorizeKeyAccess guards the local-FS /files authorization that
// closes the attachment IDOR: the key alone is not a capability, so only the
// inbox owner may read a file by key.
func TestAttachmentAuthorizeKeyAccess(t *testing.T) {
	owner := uuid.New()
	key := "burnerbyte/attachments/x/y/file.pdf"

	t.Run("owner allowed", func(t *testing.T) {
		svc := newAttachmentSvcWithOwner(owner)
		if err := svc.AuthorizeKeyAccess(context.Background(), key, owner); err != nil {
			t.Fatalf("owner should be authorized, got: %v", err)
		}
	})

	t.Run("non-owner denied", func(t *testing.T) {
		svc := newAttachmentSvcWithOwner(owner)
		attacker := uuid.New()
		err := svc.AuthorizeKeyAccess(context.Background(), key, attacker)
		if err == nil {
			t.Fatal("IDOR: a non-owner was authorized to read an attachment by key")
		}
		if !strings.Contains(err.Error(), "forbidden") {
			t.Fatalf("expected a forbidden error, got: %v", err)
		}
	})

	t.Run("malformed key rejected without a lookup", func(t *testing.T) {
		// No bucket separator: must be rejected before any repository call.
		svc := newAttachmentSvcWithOwner(owner)
		if err := svc.AuthorizeKeyAccess(context.Background(), "nokeyhere", owner); err == nil {
			t.Fatal("a key with no bucket segment should be rejected")
		}
	})
}
