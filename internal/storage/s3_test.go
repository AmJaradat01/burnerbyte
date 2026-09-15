package storage

import (
	"testing"

	"github.com/minio/minio-go/v7"
)

// A first run starts api and smtpd together; both find no bucket and both call
// MakeBucket, so one reliably loses the race. Before this was handled, the
// loser's NewS3 returned an error and the caller degraded to local-filesystem
// attachments — while its sibling used MinIO — so mail ingested by one process
// was unreadable by the other. These are the two codes S3 answers with.
func TestBucketRaceCodesAreTreatedAsSuccess(t *testing.T) {
	for _, code := range []string{"BucketAlreadyOwnedByYou", "BucketAlreadyExists"} {
		if !bucketRaceCodes[code] {
			t.Errorf("%s should be treated as a successful create", code)
		}
	}

	// A genuine failure must still propagate: silently continuing would hand
	// back a client pointed at a bucket that does not exist.
	for _, code := range []string{"AccessDenied", "InvalidBucketName", ""} {
		if bucketRaceCodes[code] {
			t.Errorf("%q must not be swallowed", code)
		}
	}
}

// Guard the extraction path too: the codes above are only reachable if
// ToErrorResponse actually parses the code out of the error minio-go returns.
func TestToErrorResponseExtractsCode(t *testing.T) {
	err := minio.ErrorResponse{Code: "BucketAlreadyOwnedByYou"}
	if got := minio.ToErrorResponse(err).Code; got != "BucketAlreadyOwnedByYou" {
		t.Errorf("ToErrorResponse().Code = %q, want BucketAlreadyOwnedByYou", got)
	}
}
