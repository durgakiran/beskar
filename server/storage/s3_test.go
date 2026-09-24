package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestS3StoreObjectKey(t *testing.T) {
	store := &S3Store{prefix: "beskar-dev/uploads"}
	if got := store.objectKey("attachments/file.pdf"); got != "beskar-dev/uploads/attachments/file.pdf" {
		t.Fatalf("got %q", got)
	}
}

func TestS3StoreObjectKeyNoPrefix(t *testing.T) {
	store := &S3Store{}
	if got := store.objectKey("attachments/file.pdf"); got != "attachments/file.pdf" {
		t.Fatalf("got %q", got)
	}
}

func TestWhiteboardAssetObjectKeyIsPageScopedAndContentAddressed(t *testing.T) {
	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if got := WhiteboardAssetObjectKey(42, hash); got != "whiteboard-assets/42/sha256/"+hash {
		t.Fatalf("WhiteboardAssetObjectKey() = %q", got)
	}
}

func TestPhase3RealS3CompatibleProbe(t *testing.T) {
	endpoint := os.Getenv("P3_REAL_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("P3_REAL_S3_ENDPOINT is only set by the disposable Phase 3 topology")
	}
	ctx := context.Background()
	cfg := Config{Bucket: "phase3-assets", Endpoint: endpoint, Region: "phase3", AccessKeyID: "phase3-access", SecretAccessKey: "phase3-secret", Prefix: "probe"}
	store, err := NewS3Store(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(cfg.Bucket)}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.client.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{
		Bucket:                  aws.String(cfg.Bucket),
		VersioningConfiguration: &types.VersioningConfiguration{Status: types.BucketVersioningStatusEnabled},
	}); err != nil {
		t.Fatal(err)
	}
	key := WhiteboardAssetObjectKey(41, "a"+string(bytes.Repeat([]byte("b"), 63)))
	payload := []byte("phase3-real-s3-payload")
	for attempt := 0; attempt < 2; attempt++ {
		if err = store.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), "image/png"); err != nil {
			t.Fatalf("deduplicated put %d: %v", attempt+1, err)
		}
	}
	headBeforeDelete, err := store.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.Bucket), Key: aws.String(store.objectKey(key)),
	})
	if err != nil || headBeforeDelete.VersionId == nil || *headBeforeDelete.VersionId == "" {
		t.Fatalf("versioned head before delete: output=%#v err=%v", headBeforeDelete, err)
	}
	sourceVersionID := *headBeforeDelete.VersionId
	if exists, existsErr := store.Exists(ctx, key); existsErr != nil || !exists {
		t.Fatalf("head after put: exists=%v err=%v", exists, existsErr)
	}
	reader, metadata, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, payload) || metadata.Size != int64(len(payload)) || metadata.ContentType != "image/png" {
		t.Fatalf("restored object mismatch: bytes=%q metadata=%#v read=%v close=%v", got, metadata, readErr, closeErr)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err = store.Delete(cancelled, key); err == nil {
		t.Fatal("cancelled delete must fail before bounded retry")
	}
	if err = store.Delete(ctx, key); err != nil {
		t.Fatalf("delete retry failed: %v", err)
	}
	if exists, existsErr := store.Exists(ctx, key); existsErr != nil || exists {
		t.Fatalf("object remained after delete retry: exists=%v err=%v", exists, existsErr)
	}
	versionsAfterDelete, err := store.client.ListObjectVersions(ctx, &s3.ListObjectVersionsInput{
		Bucket: aws.String(cfg.Bucket), Prefix: aws.String(store.objectKey(key)),
	})
	if err != nil || len(versionsAfterDelete.DeleteMarkers) == 0 {
		t.Fatalf("delete marker was not observed: versions=%#v err=%v", versionsAfterDelete, err)
	}
	copySource := cfg.Bucket + "/" + store.objectKey(key) + "?versionId=" + sourceVersionID
	restoreOutput, err := store.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket: aws.String(cfg.Bucket), Key: aws.String(store.objectKey(key)), CopySource: aws.String(copySource),
	})
	if err != nil || restoreOutput.VersionId == nil || *restoreOutput.VersionId == "" {
		t.Fatalf("object-version restore failed: output=%#v err=%v", restoreOutput, err)
	}
	restoredVersionID := *restoreOutput.VersionId
	restored, restoredMetadata, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	restoredBytes, readErr := io.ReadAll(restored)
	closeErr = restored.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(restoredBytes, payload) ||
		restoredMetadata.Size != int64(len(payload)) || restoredMetadata.ContentType != "image/png" {
		t.Fatalf("post-recovery object mismatch: bytes=%q metadata=%#v read=%v close=%v", restoredBytes, restoredMetadata, readErr, closeErr)
	}
	headAfterRestore, err := store.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.Bucket), Key: aws.String(store.objectKey(key)),
	})
	if err != nil || aws.ToString(headAfterRestore.VersionId) != restoredVersionID {
		t.Fatalf("restored version is not current: head=%#v err=%v", headAfterRestore, err)
	}
	resultPath := os.Getenv("P3_REAL_S3_RESULT_FILE")
	if resultPath == "" {
		t.Fatal("P3_REAL_S3_RESULT_FILE is required for the repository-owned MinIO probe")
	}
	payloadHash := sha256.Sum256(payload)
	metadataHash := sha256.Sum256([]byte(strings.Join([]string{
		restoredMetadata.ContentType,
		aws.ToString(headAfterRestore.ETag),
		strconv.FormatInt(restoredMetadata.Size, 10),
	}, "\x00")))
	result := map[string]any{
		"bucket": cfg.Bucket, "object_key": store.objectKey(key),
		"source_version_id": sourceVersionID, "restored_version_id": restoredVersionID,
		"delete_marker_version_id": aws.ToString(versionsAfterDelete.DeleteMarkers[0].VersionId),
		"content_sha256":           hex.EncodeToString(payloadHash[:]),
		"metadata_sha256":          hex.EncodeToString(metadataHash[:]),
		"content_type":             restoredMetadata.ContentType, "size": restoredMetadata.Size,
		"etag_before_delete":     aws.ToString(headBeforeDelete.ETag),
		"etag_after_restore":     aws.ToString(headAfterRestore.ETag),
		"observed_version_count": len(versionsAfterDelete.Versions),
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(resultPath), filepath.Base(resultPath)+".*.tmp")
	if err != nil {
		t.Fatal(err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(append(encoded, '\n'))
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeResultErr := temporary.Close(); err == nil {
		err = closeResultErr
	}
	if err == nil {
		err = os.Rename(temporaryName, resultPath)
	}
	if err != nil {
		t.Fatal(err)
	}
}
