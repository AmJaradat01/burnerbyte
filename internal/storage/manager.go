package storage

import (
	"context"
	"io"
	"net/url"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"

	"gitlab.com/amjaradat01/burnerbyte/internal/config"
)

// Backend is the subset of object-storage operations the app uses. Both
// *minio.Client and *LocalFS implement it.
type Backend interface {
	PutObject(ctx context.Context, bucket, key string, reader io.Reader, size int64, opts minio.PutObjectOptions) (minio.UploadInfo, error)
	RemoveObject(ctx context.Context, bucket, key string, opts minio.RemoveObjectOptions) error
	PresignedGetObject(ctx context.Context, bucket, key string, expiry time.Duration, reqParams url.Values) (*url.URL, error)
	BucketExists(ctx context.Context, bucket string) (bool, error)
}

// Manager is a hot-swappable object-storage backend. It implements Backend by
// delegating to the current backend under an RWMutex, so a storage config
// change (Reload) takes effect for all consumers without re-wiring or a restart.
// Reload builds and verifies the new backend before swapping, so a failure
// leaves the existing backend in place.
type Manager struct {
	mu      sync.RWMutex
	backend Backend
}

// NewManager wraps an initial backend (an *minio.Client or *LocalFS).
func NewManager(initial Backend) *Manager {
	return &Manager{backend: initial}
}

func (m *Manager) current() Backend {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.backend
}

func (m *Manager) PutObject(ctx context.Context, bucket, key string, reader io.Reader, size int64, opts minio.PutObjectOptions) (minio.UploadInfo, error) {
	return m.current().PutObject(ctx, bucket, key, reader, size, opts)
}

func (m *Manager) RemoveObject(ctx context.Context, bucket, key string, opts minio.RemoveObjectOptions) error {
	return m.current().RemoveObject(ctx, bucket, key, opts)
}

func (m *Manager) PresignedGetObject(ctx context.Context, bucket, key string, expiry time.Duration, reqParams url.Values) (*url.URL, error) {
	return m.current().PresignedGetObject(ctx, bucket, key, expiry, reqParams)
}

func (m *Manager) BucketExists(ctx context.Context, bucket string) (bool, error) {
	return m.current().BucketExists(ctx, bucket)
}

// IsS3 reports whether the current backend is a real S3/MinIO client (as opposed
// to the local-filesystem fallback). Health checks use this to decide whether to
// probe object storage.
func (m *Manager) IsS3() bool {
	_, ok := m.current().(*minio.Client)
	return ok
}

// Reload builds a new S3/MinIO client from cfg (verifying/creating the bucket),
// then swaps it in atomically. On error the existing backend is untouched.
func (m *Manager) Reload(ctx context.Context, cfg config.MinIOConfig) error {
	nc, err := NewS3(ctx, cfg)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.backend = nc
	m.mu.Unlock()
	return nil
}
