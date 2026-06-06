package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
	"gitlab.com/burnerbyte/burnerbyte/internal/repository/postgres"
)

// ObjectStorage is the interface for storing and retrieving attachment files.
// Implemented by *minio.Client and *storage.LocalFS.
type ObjectStorage interface {
	PutObject(ctx context.Context, bucket, key string, reader io.Reader, size int64, opts minio.PutObjectOptions) (minio.UploadInfo, error)
	RemoveObject(ctx context.Context, bucket, key string, opts minio.RemoveObjectOptions) error
	PresignedGetObject(ctx context.Context, bucket, key string, expiry time.Duration, reqParams url.Values) (*url.URL, error)
}

type AttachmentService struct {
	attachmentRepo *postgres.AttachmentRepo
	emailRepo      *postgres.EmailRepo
	inboxRepo      *postgres.InboxRepo
	s3             ObjectStorage
	bucket         string
	maxSizeMB      int
	presignedTTL   time.Duration
}

func NewAttachmentService(
	attachmentRepo *postgres.AttachmentRepo,
	emailRepo *postgres.EmailRepo,
	inboxRepo *postgres.InboxRepo,
	s3 ObjectStorage,
	cfg config.MinIOConfig,
	maxSizeMB int,
	presignedTTL time.Duration,
) *AttachmentService {
	if presignedTTL <= 0 {
		presignedTTL = 15 * time.Minute
	}
	return &AttachmentService{
		attachmentRepo: attachmentRepo,
		emailRepo:      emailRepo,
		inboxRepo:      inboxRepo,
		s3:             s3,
		bucket:         cfg.Bucket,
		maxSizeMB:      maxSizeMB,
		presignedTTL:   presignedTTL,
	}
}

func (s *AttachmentService) StoreAttachment(ctx context.Context, emailID uuid.UUID, filename, contentType string, data []byte) (*domain.Attachment, error) {
	maxBytes := int64(s.maxSizeMB) * 1024 * 1024
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("attachment exceeds max size (%dMB)", s.maxSizeMB)
	}

	storageKey := fmt.Sprintf("attachments/%s/%s/%s", emailID, uuid.New(), sanitizeFilename(filename))

	_, err := s.s3.PutObject(ctx, s.bucket, storageKey, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return nil, fmt.Errorf("upload to s3: %w", err)
	}

	a := &domain.Attachment{
		ID:          uuid.New(),
		EmailID:     emailID,
		Filename:    filename,
		ContentType: contentType,
		SizeBytes:   int64(len(data)),
		StorageKey:  storageKey,
	}

	if err := s.attachmentRepo.Create(ctx, a); err != nil {
		// Cleanup S3 on DB failure
		s.s3.RemoveObject(ctx, s.bucket, storageKey, minio.RemoveObjectOptions{})
		return nil, err
	}

	return a, nil
}

func (s *AttachmentService) GetDownloadURL(ctx context.Context, attachmentID, userID uuid.UUID) (string, error) {
	a, err := s.attachmentRepo.GetByID(ctx, attachmentID)
	if err != nil {
		return "", err
	}

	if err := s.checkOwnership(ctx, a, userID); err != nil {
		return "", err
	}

	// Set response headers on the presigned URL to force download and prevent XSS
	safeFilename := strings.NewReplacer(`"`, `'`, "\n", "", "\r", "").Replace(a.Filename)
	reqParams := url.Values{}
	reqParams.Set("response-content-disposition", fmt.Sprintf("attachment; filename=\"%s\"", safeFilename))

	presignedURL, err := s.s3.PresignedGetObject(ctx, s.bucket, a.StorageKey, s.presignedTTL, reqParams)
	if err != nil {
		return "", fmt.Errorf("generate presigned url: %w", err)
	}

	return presignedURL.String(), nil
}

// checkOwnership returns nil only when userID owns the inbox the attachment's
// email belongs to. This is the single authorization rule for attachment access.
func (s *AttachmentService) checkOwnership(ctx context.Context, a *domain.Attachment, userID uuid.UUID) error {
	email, err := s.emailRepo.GetByID(ctx, a.EmailID)
	if err != nil {
		return err
	}
	inbox, err := s.inboxRepo.GetByID(ctx, email.InboxID)
	if err != nil {
		return err
	}
	if inbox.CreatedBy != userID {
		return fmt.Errorf("forbidden: not your attachment")
	}
	return nil
}

// AuthorizeKeyAccess verifies that userID may read the file served at the given
// local-storage URL key. The key is "{bucket}/{storage_key}" (see LocalFS.
// PresignedGetObject); the bucket segment is stripped to recover the stored
// storage_key, the attachment is resolved by it, and ownership is enforced.
// The local-FS /files endpoint carries no signature or expiry, so without this
// any authenticated user could read any attachment by key (IDOR).
func (s *AttachmentService) AuthorizeKeyAccess(ctx context.Context, urlKey string, userID uuid.UUID) error {
	// Strip the leading bucket segment. Bucket names contain no "/", so the
	// remainder is exactly the stored storage_key ("attachments/<email>/...").
	parts := strings.SplitN(urlKey, "/", 2)
	if len(parts) != 2 || parts[1] == "" {
		return fmt.Errorf("forbidden: invalid key")
	}
	a, err := s.attachmentRepo.GetByStorageKey(ctx, parts[1])
	if err != nil {
		return err
	}
	return s.checkOwnership(ctx, a, userID)
}

func (s *AttachmentService) DeleteByEmail(ctx context.Context, emailID uuid.UUID) error {
	keys, err := s.attachmentRepo.DeleteByEmail(ctx, emailID)
	if err != nil {
		return err
	}
	for _, key := range keys {
		s.s3.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
	}
	return nil
}

// sanitizeFilename strips path traversal sequences and dangerous characters
// from attachment filenames to prevent S3 key manipulation.
func sanitizeFilename(name string) string {
	// Extract just the base filename, stripping any directory components
	name = filepath.Base(name)
	// Remove null bytes
	name = strings.ReplaceAll(name, "\x00", "")
	// Replace path separators that survived Base()
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "..", "_")
	if name == "" || name == "." {
		name = "unnamed"
	}
	// Limit length
	if len(name) > 255 {
		name = name[:255]
	}
	return name
}
