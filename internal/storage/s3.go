package storage

import (
	"context"
	"fmt"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"gitlab.com/burnerbyte/burnerbyte/internal/config"
)

// bucketRaceCodes are the S3 responses to a CreateBucket for a bucket that came
// into existence between our BucketExists check and the create. api and smtpd
// boot at the same time and both run this, so exactly one of them loses that
// race on a first run. The bucket it wanted exists and belongs to us, so the
// only correct reading is success — returning the error made the loser fall
// back to local-filesystem attachments while its sibling used MinIO, leaving
// mail ingested by one process unreadable by the other.
var bucketRaceCodes = map[string]bool{
	"BucketAlreadyOwnedByYou": true,
	"BucketAlreadyExists":     true,
}

func NewS3(ctx context.Context, cfg config.MinIOConfig) (*minio.Client, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}

	exists, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket: %w", err)
	}

	if !exists {
		if err := client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
			if !bucketRaceCodes[minio.ToErrorResponse(err).Code] {
				return nil, fmt.Errorf("create bucket: %w", err)
			}
		}
	}

	return client, nil
}
