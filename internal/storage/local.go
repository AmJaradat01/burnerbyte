package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/minio/minio-go/v7"
)

// LocalFS implements the subset of minio.Client methods used by AttachmentService,
// storing files on the local filesystem. Use for development/testing without MinIO.
type LocalFS struct {
	basePath string
	baseURL  string // e.g. "http://localhost:8080/api/v1/files"
}

// NewLocalFS creates a local filesystem storage backend.
// basePath is where files are stored on disk.
// baseURL is the public URL prefix for serving files (the API will serve them).
func NewLocalFS(basePath, baseURL string) (*LocalFS, error) {
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	return &LocalFS{basePath: basePath, baseURL: baseURL}, nil
}

// PutObject stores a file on the local filesystem.
func (l *LocalFS) PutObject(_ context.Context, bucket, key string, reader io.Reader, _ int64, _ minio.PutObjectOptions) (minio.UploadInfo, error) {
	fullPath := filepath.Join(l.basePath, bucket, key)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return minio.UploadInfo{}, err
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return minio.UploadInfo{}, err
	}
	if err := os.WriteFile(fullPath, data, 0644); err != nil {
		return minio.UploadInfo{}, err
	}
	return minio.UploadInfo{Key: key, Size: int64(len(data))}, nil
}

// RemoveObject deletes a file from the local filesystem.
func (l *LocalFS) RemoveObject(_ context.Context, bucket, key string, _ minio.RemoveObjectOptions) error {
	fullPath := filepath.Join(l.basePath, bucket, key)
	return os.Remove(fullPath)
}

// PresignedGetObject returns a URL to download the file.
// For local storage, this returns a direct URL to the API file-serving endpoint.
func (l *LocalFS) PresignedGetObject(_ context.Context, bucket, key string, _ time.Duration, _ url.Values) (*url.URL, error) {
	// Serve via the API's /files endpoint with the storage key as a query param
	u, err := url.Parse(l.baseURL)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("key", filepath.Join(bucket, key))
	u.RawQuery = q.Encode()
	return u, nil
}

// BucketExists always returns true for local storage.
func (l *LocalFS) BucketExists(_ context.Context, _ string) (bool, error) {
	return true, nil
}

// MakeBucket is a no-op for local storage.
func (l *LocalFS) MakeBucket(_ context.Context, _ string, _ minio.MakeBucketOptions) error {
	return nil
}

// GetObject reads a file from local storage.
func (l *LocalFS) GetObject(_ context.Context, bucket, key string, _ minio.GetObjectOptions) (io.ReadCloser, error) {
	fullPath := filepath.Join(l.basePath, bucket, key)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, err
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

// ServeFile reads and returns the file bytes for a given key.
func (l *LocalFS) ServeFile(key string) ([]byte, error) {
	fullPath := filepath.Join(l.basePath, key)
	return os.ReadFile(fullPath)
}
