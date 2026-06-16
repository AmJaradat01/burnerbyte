package storage

import (
	"context"
	"io"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// fakeBackend records calls so delegation can be asserted without real storage.
type fakeBackend struct {
	puts       int
	lastBucket string
	lastKey    string
}

func (f *fakeBackend) PutObject(_ context.Context, bucket, key string, _ io.Reader, _ int64, _ minio.PutObjectOptions) (minio.UploadInfo, error) {
	f.puts++
	f.lastBucket, f.lastKey = bucket, key
	return minio.UploadInfo{}, nil
}
func (f *fakeBackend) RemoveObject(_ context.Context, _, _ string, _ minio.RemoveObjectOptions) error {
	return nil
}
func (f *fakeBackend) PresignedGetObject(_ context.Context, _, _ string, _ time.Duration, _ url.Values) (*url.URL, error) {
	return &url.URL{}, nil
}
func (f *fakeBackend) BucketExists(_ context.Context, _ string) (bool, error) { return true, nil }

func TestManagerDelegatesToCurrentBackend(t *testing.T) {
	fb := &fakeBackend{}
	m := NewManager(fb)
	if _, err := m.PutObject(context.Background(), "bucket-a", "key-1", strings.NewReader("x"), 1, minio.PutObjectOptions{}); err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	if fb.puts != 1 || fb.lastBucket != "bucket-a" || fb.lastKey != "key-1" {
		t.Errorf("delegation failed: puts=%d bucket=%q key=%q", fb.puts, fb.lastBucket, fb.lastKey)
	}
}

func TestManagerIsS3(t *testing.T) {
	lfs, err := NewLocalFS(t.TempDir(), "http://localhost/files")
	if err != nil {
		t.Fatalf("NewLocalFS: %v", err)
	}
	if NewManager(lfs).IsS3() {
		t.Error("local filesystem backend must not report IsS3")
	}

	mc, err := minio.New("localhost:9000", &minio.Options{Creds: credentials.NewStaticV4("a", "b", ""), Secure: false})
	if err != nil {
		t.Fatalf("minio.New: %v", err)
	}
	if !NewManager(mc).IsS3() {
		t.Error("minio client backend must report IsS3")
	}
}

// A failed Reload (unreachable endpoint) must not swap out the working backend.
func TestManagerReloadFailureKeepsBackend(t *testing.T) {
	fb := &fakeBackend{}
	m := NewManager(fb)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := m.Reload(ctx, config.MinIOConfig{Endpoint: "127.0.0.1:1", AccessKey: "a", SecretKey: "b", Bucket: "x"})
	if err == nil {
		t.Fatal("expected Reload to fail against an unreachable endpoint")
	}
	if m.IsS3() {
		t.Error("backend was swapped despite Reload failure")
	}
	if _, err := m.PutObject(context.Background(), "b", "k", strings.NewReader("x"), 1, minio.PutObjectOptions{}); err != nil {
		t.Fatalf("PutObject after failed reload: %v", err)
	}
	if fb.puts != 1 {
		t.Error("expected delegation to still reach the original backend after failed reload")
	}
}
