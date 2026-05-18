package storage_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"bytes"

	"github.com/minio/minio-go/v7"

	"gitlab.com/burnerbyte/burnerbyte/internal/storage"
)

func TestLocalFS_PutAndServe(t *testing.T) {
	dir := t.TempDir()
	baseURL := "http://localhost:8080/api/v1/files"

	fs, err := storage.NewLocalFS(dir, baseURL)
	if err != nil {
		t.Fatalf("NewLocalFS: %v", err)
	}

	ctx := context.Background()
	bucket := "test-bucket"
	key := "attachments/email-123/uuid-456/test-file.pdf"
	content := []byte("fake PDF content here")

	// Test PutObject
	info, err := fs.PutObject(ctx, bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{ContentType: "application/pdf"})
	if err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	if info.Size != int64(len(content)) {
		t.Errorf("PutObject size = %d, want %d", info.Size, len(content))
	}

	// Verify file exists on disk
	fullPath := filepath.Join(dir, bucket, key)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("file not on disk: %v", err)
	}
	if !bytes.Equal(data, content) {
		t.Error("file content mismatch")
	}

	// Test PresignedGetObject
	presigned, err := fs.PresignedGetObject(ctx, bucket, key, 15*time.Minute, url.Values{})
	if err != nil {
		t.Fatalf("PresignedGetObject: %v", err)
	}
	if presigned.Host == "" {
		t.Error("presigned URL has no host")
	}
	qKey := presigned.Query().Get("key")
	expectedKey := filepath.Join(bucket, key)
	if qKey != expectedKey {
		t.Errorf("presigned key = %q, want %q", qKey, expectedKey)
	}

	// Test ServeFile
	served, err := fs.ServeFile(filepath.Join(bucket, key))
	if err != nil {
		t.Fatalf("ServeFile: %v", err)
	}
	if !bytes.Equal(served, content) {
		t.Error("ServeFile content mismatch")
	}

	// Test RemoveObject
	err = fs.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		t.Fatalf("RemoveObject: %v", err)
	}
	if _, err := os.Stat(fullPath); !os.IsNotExist(err) {
		t.Error("file still exists after RemoveObject")
	}
}

func TestLocalFS_BucketExists(t *testing.T) {
	dir := t.TempDir()
	fs, _ := storage.NewLocalFS(dir, "http://localhost:8080/api/v1/files")

	exists, err := fs.BucketExists(context.Background(), "any-bucket")
	if err != nil {
		t.Fatalf("BucketExists: %v", err)
	}
	if !exists {
		t.Error("BucketExists should always return true for LocalFS")
	}
}
