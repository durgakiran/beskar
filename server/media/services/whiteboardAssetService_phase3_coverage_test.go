package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
)

type phase3Object struct {
	data        []byte
	contentType string
}

type phase3S3Fixture struct {
	testing    *testing.T
	server     *httptest.Server
	mu         sync.Mutex
	objects    map[string]phase3Object
	failDelete bool
}

func newPhase3S3Fixture(t *testing.T) *phase3S3Fixture {
	t.Helper()
	fixture := &phase3S3Fixture{testing: t, objects: make(map[string]phase3Object)}
	fixture.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		key := strings.TrimPrefix(r.URL.Path, "/phase3-bucket/")
		if strings.Contains(key, "forced-error") {
			http.Error(w, "forced fixture error", http.StatusInternalServerError)
			return
		}
		switch r.Method {
		case http.MethodHead:
			object, ok := fixture.objects[key]
			if !ok {
				w.Header().Set("x-amz-error-code", "NoSuchKey")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Length", fmt.Sprint(len(object.data)))
			w.Header().Set("Content-Type", object.contentType)
		case http.MethodPut:
			data, err := io.ReadAll(r.Body)
			if err != nil {
				fixture.testing.Errorf("read S3 fixture PUT: %v", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			fixture.objects[key] = phase3Object{data: data, contentType: r.Header.Get("Content-Type")}
			w.Header().Set("ETag", `"phase3"`)
		case http.MethodGet:
			object, ok := fixture.objects[key]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Length", fmt.Sprint(len(object.data)))
			w.Header().Set("Content-Type", object.contentType)
			_, _ = w.Write(object.data)
		case http.MethodDelete:
			if fixture.failDelete {
				http.Error(w, "forced delete failure", http.StatusInternalServerError)
				return
			}
			delete(fixture.objects, key)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(fixture.server.Close)
	return fixture
}

func phase3JPEG(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 12, 6))
	picture.Set(0, 0, color.RGBA{G: 255, A: 255})
	if err := jpeg.Encode(&output, picture, nil); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func phase3Hash(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func TestPhase3WhiteboardAssetServiceIntegrationCoverage(t *testing.T) {
	if os.Getenv("P3_GO_ASSET_INTEGRATION") != "1" {
		t.Skip("owned Phase 3 integration topology is not enabled")
	}
	ctx := context.Background()

	t.Run("inspection boundaries", func(t *testing.T) {
		if validContentHash("") || validContentHash(strings.Repeat("A", 64)) || validContentHash(strings.Repeat("z", 64)) {
			t.Fatal("invalid hashes must be rejected")
		}
		if _, err := InspectWhiteboardRaster(nil, "", ""); err == nil {
			t.Fatal("empty input must fail")
		}
		if _, err := InspectWhiteboardRaster(make([]byte, MaxWhiteboardAssetBytes+1), "", strings.Repeat("a", 64)); err == nil {
			t.Fatal("oversized input must fail")
		}
		if _, err := InspectWhiteboardRaster(make([]byte, 30), "", strings.Repeat("a", 64)); err == nil {
			t.Fatal("unsupported input must fail")
		}
		jpegBytes := phase3JPEG(t)
		inspected, err := InspectWhiteboardRaster(jpegBytes, "", phase3Hash(jpegBytes))
		if err != nil || inspected.MimeType != "image/jpeg" || inspected.Width != 12 || inspected.Height != 6 {
			t.Fatalf("JPEG inspection failed: %#v %v", inspected, err)
		}
		webp := make([]byte, 30)
		copy(webp, "RIFF")
		copy(webp[8:], "WEBPVP8X")
		webp[24], webp[27] = 9, 4
		if _, err := InspectWhiteboardRaster(webp, "image/webp", phase3Hash(webp)); err != nil {
			t.Fatalf("extended WebP inspection failed: %v", err)
		}
		if _, _, err := webPExtendedDimensions(make([]byte, 29)); err == nil {
			t.Fatal("truncated extended WebP must fail")
		}
		for _, dimensions := range [][2]int{{0, 1}, {1, 0}, {MaxWhiteboardAssetDimension + 1, 1}, {10_000, 10_000}} {
			if err := validateWhiteboardRasterDimensions(dimensions[0], dimensions[1]); err == nil {
				t.Fatalf("invalid dimensions passed: %v", dimensions)
			}
		}
	})

	if record, err := GetWhiteboardAsset(ctx, 0, strings.Repeat("a", 64)); err != nil || record != nil {
		t.Fatalf("invalid page lookup must be empty: %#v %v", record, err)
	}
	if record, err := GetWhiteboardAsset(ctx, 1, "invalid"); err != nil || record != nil {
		t.Fatalf("invalid hash lookup must be empty: %#v %v", record, err)
	}

	fixture := newPhase3S3Fixture(t)
	for key, value := range map[string]string{
		"STORAGE_S3_BUCKET": "phase3-bucket", "STORAGE_S3_ENDPOINT": fixture.server.URL,
		"STORAGE_S3_REGION": "phase3", "STORAGE_S3_ACCESS_KEY_ID": "phase3-access",
		"STORAGE_S3_SECRET_ACCESS_KEY": "phase3-secret", "STORAGE_S3_PREFIX": "coverage",
	} {
		t.Setenv(key, value)
	}
	blobstorage.ResetForTest()
	t.Cleanup(blobstorage.ResetForTest)

	data := testPNG(t)
	inspected, err := InspectWhiteboardRaster(data, "image/png", phase3Hash(data))
	if err != nil {
		t.Fatal(err)
	}
	record, created, err := SaveWhiteboardAsset(ctx, quota.UploadReservation{}, 41, "phase3-user", inspected, data)
	if err != nil || !created {
		t.Fatalf("save failed: %#v created=%v err=%v", record, created, err)
	}
	if record.StorageKey != blobstorage.WhiteboardAssetObjectKey(41, inspected.ContentHash) {
		t.Fatalf("unexpected storage key: %s", record.StorageKey)
	}

	existing, created, err := SaveWhiteboardAsset(ctx, quota.UploadReservation{}, 41, "other-user", inspected, data)
	if err != nil || created || existing.ContentHash != inspected.ContentHash {
		t.Fatalf("dedupe failed: %#v created=%v err=%v", existing, created, err)
	}
	loaded, err := GetWhiteboardAsset(ctx, 41, inspected.ContentHash)
	if err != nil || loaded == nil || loaded.Provenance["source"] != "whiteboard-upload" {
		t.Fatalf("lookup failed: %#v %v", loaded, err)
	}

	reader, metadata, err := OpenWhiteboardAsset(ctx, record.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil || !bytes.Equal(opened, data) || metadata.ContentType != "image/png" || metadata.Size != int64(len(data)) {
		t.Fatalf("opened object mismatch: metadata=%#v err=%v", metadata, err)
	}
	keys, err := ListWhiteboardAssetStorageKeys(ctx, 41)
	if err != nil || len(keys) != 1 || keys[0] != record.StorageKey {
		t.Fatalf("list failed: %v %v", keys, err)
	}

	t.Run("staging replay cancellation and recoverable cleanup", func(t *testing.T) {
		stagedData := phase3JPEG(t)
		stagedInspected, inspectErr := InspectWhiteboardRaster(stagedData, "image/jpeg", phase3Hash(stagedData))
		if inspectErr != nil {
			t.Fatal(inspectErr)
		}
		staging, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, stagedInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		if _, stageErr := StageWhiteboardAsset(ctx, staging.Token, 41, stagedInspected.ContentHash, "phase3-user", stagedInspected, stagedData); stageErr != nil {
			t.Fatal(stageErr)
		}
		var status, correlation string
		var reserved int64
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT status, quota_reserved_bytes, quota_correlation_id
			FROM core.whiteboard_asset_staging WHERE token=$1`, staging.Token).Scan(&status, &reserved, &correlation); queryErr != nil {
			t.Fatal(queryErr)
		}
		if status != "staged" || reserved != int64(len(stagedData)) || correlation == "" {
			t.Fatalf("reservation metadata was not atomically recoverable: status=%s reserved=%d correlation=%q", status, reserved, correlation)
		}
		first, created, commitErr := CommitWhiteboardAssetStaging(ctx, staging.Token, 41, stagedInspected.ContentHash, "phase3-user")
		if commitErr != nil || !created {
			t.Fatalf("commit failed: %#v %v", first, commitErr)
		}
		replayed, replayCreated, replayErr := CommitWhiteboardAssetStaging(ctx, staging.Token, 41, stagedInspected.ContentHash, "phase3-user")
		if replayErr != nil || replayCreated || replayed == nil {
			t.Fatalf("lost-response replay failed: %#v %v", replayed, replayErr)
		}
		if cancelErr := CancelWhiteboardAssetStaging(context.Background(), staging.Token, 41, stagedInspected.ContentHash, "phase3-user"); cancelErr != nil {
			t.Fatal(cancelErr)
		}
		if replayed, _, replayErr := CommitWhiteboardAssetStaging(ctx, staging.Token, 41, stagedInspected.ContentHash, "phase3-user"); replayed != nil || !errors.Is(replayErr, ErrWhiteboardAssetCompensated) {
			t.Fatalf("compensated token replay was not terminal: %#v %v", replayed, replayErr)
		}
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT status FROM core.whiteboard_asset_staging WHERE token=$1`, staging.Token).Scan(&status); queryErr != nil || status != "compensated" {
			t.Fatalf("compensated terminal state was not persisted: status=%q err=%v", status, queryErr)
		}
		if durable, lookupErr := GetWhiteboardAsset(ctx, 41, stagedInspected.ContentHash); lookupErr != nil || durable != nil {
			t.Fatalf("unreferenced committed upload was not compensated: %#v %v", durable, lookupErr)
		}

		failedCleanup, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, stagedInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		if _, stageErr := StageWhiteboardAsset(ctx, failedCleanup.Token, 41, stagedInspected.ContentHash, "phase3-user", stagedInspected, stagedData); stageErr != nil {
			t.Fatal(stageErr)
		}
		fixture.mu.Lock()
		fixture.failDelete = true
		fixture.mu.Unlock()
		if cancelErr := CancelWhiteboardAssetStaging(context.Background(), failedCleanup.Token, 41, stagedInspected.ContentHash, "phase3-user"); cancelErr == nil {
			t.Fatal("blob rollback failure must be surfaced")
		}
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT status, quota_reserved_bytes FROM core.whiteboard_asset_staging WHERE token=$1`, failedCleanup.Token).Scan(&status, &reserved); queryErr != nil {
			t.Fatal(queryErr)
		}
		if status != "cleanup_pending" || reserved != int64(len(stagedData)) {
			t.Fatalf("rollback failure discarded recovery metadata: status=%s reserved=%d", status, reserved)
		}
		worker := NewWhiteboardStagingCleanupWorker(WhiteboardStagingCleanupConfig{
			Enabled: true, Interval: time.Minute, Expiry: time.Hour, BatchSize: 10, MaxBackoff: time.Hour,
		})
		if _, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging SET next_cleanup_at=now()-interval '1 minute' WHERE token=$1`, failedCleanup.Token); updateErr != nil {
			t.Fatal(updateErr)
		}
		failedResult, sweepErr := worker.RunOnce(ctx)
		if sweepErr != nil || failedResult.Failed != 1 {
			t.Fatalf("failed cleanup was not retained for bounded retry: %#v %v", failedResult, sweepErr)
		}
		var cleanupAttempts int
		var cleanupError string
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT cleanup_attempts, cleanup_error FROM core.whiteboard_asset_staging WHERE token=$1`, failedCleanup.Token).Scan(&cleanupAttempts, &cleanupError); queryErr != nil || cleanupAttempts != 1 || cleanupError == "" {
			t.Fatalf("cleanup retry metadata missing: attempts=%d error=%q query=%v", cleanupAttempts, cleanupError, queryErr)
		}

		deadLetterData := append(append([]byte{}, stagedData...), 0)
		deadLetterInspected, inspectErr := InspectWhiteboardRaster(deadLetterData, "image/jpeg", phase3Hash(deadLetterData))
		if inspectErr != nil {
			t.Fatal(inspectErr)
		}
		deadLetter, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, deadLetterInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		if _, stageErr := StageWhiteboardAsset(ctx, deadLetter.Token, 41, deadLetterInspected.ContentHash, "phase3-user", deadLetterInspected, deadLetterData); stageErr != nil {
			t.Fatal(stageErr)
		}
		if cancelErr := CancelWhiteboardAssetStaging(context.Background(), deadLetter.Token, 41, deadLetterInspected.ContentHash, "phase3-user"); cancelErr == nil {
			t.Fatal("dead-letter fixture must begin with retryable blob cleanup failure")
		}
		if _, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging SET next_cleanup_at=now()-interval '1 minute' WHERE token=$1`, deadLetter.Token); updateErr != nil {
			t.Fatal(updateErr)
		}
		if _, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging SET next_cleanup_at=now()+interval '1 hour' WHERE token=$1`, failedCleanup.Token); updateErr != nil {
			t.Fatal(updateErr)
		}
		deadLetterWorker := NewWhiteboardStagingCleanupWorker(WhiteboardStagingCleanupConfig{
			Enabled: true, Interval: time.Minute, Expiry: time.Hour, BatchSize: 1, MaxAttempts: 1, MaxBackoff: time.Hour,
		})
		deadLetterResult, sweepErr := deadLetterWorker.RunOnce(ctx)
		if sweepErr != nil || deadLetterResult.Exhausted != 1 || deadLetterResult.Failed != 1 {
			t.Fatalf("cleanup exhaustion was not observable: %#v %v", deadLetterResult, sweepErr)
		}
		var sourceStatus, storageKey, exhaustedError string
		var exhaustedAt time.Time
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT status, cleanup_source_status, storage_key,
			cleanup_error, cleanup_exhausted_at, quota_reserved_bytes
			FROM core.whiteboard_asset_staging WHERE token=$1`, deadLetter.Token).
			Scan(&status, &sourceStatus, &storageKey, &exhaustedError, &exhaustedAt, &reserved); queryErr != nil {
			t.Fatal(queryErr)
		}
		if status != "cleanup_exhausted" || sourceStatus != "cleanup_pending" || storageKey == "" || exhaustedError == "" || exhaustedAt.IsZero() || reserved != int64(len(deadLetterData)) {
			t.Fatalf("dead-letter recovery metadata missing: status=%q source=%q key=%q error=%q exhausted=%v reserved=%d",
				status, sourceStatus, storageKey, exhaustedError, exhaustedAt, reserved)
		}
		preparedOnly, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, stagedInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		stagedExpired, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, stagedInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		if _, stageErr := StageWhiteboardAsset(ctx, stagedExpired.Token, 41, stagedInspected.ContentHash, "phase3-user", stagedInspected, stagedData); stageErr != nil {
			t.Fatal(stageErr)
		}
		fixture.mu.Lock()
		fixture.failDelete = false
		fixture.mu.Unlock()
		if _, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging SET updated_at=now()-interval '2 hours', next_cleanup_at=now()-interval '1 minute'
			WHERE token=ANY($1)`, []uuid.UUID{failedCleanup.Token, preparedOnly.Token, stagedExpired.Token}); updateErr != nil {
			t.Fatal(updateErr)
		}
		result, sweepErr := worker.RunOnce(ctx)
		if sweepErr != nil || result.Cleaned != 3 || result.Failed != 0 {
			t.Fatalf("interrupted staging sweep failed: %#v %v", result, sweepErr)
		}
		for _, token := range []uuid.UUID{failedCleanup.Token, preparedOnly.Token, stagedExpired.Token} {
			if queryErr := core.GetPool().QueryRow(ctx, `SELECT status, quota_reserved_bytes FROM core.whiteboard_asset_staging WHERE token=$1`, token).Scan(&status, &reserved); queryErr != nil || status != "cancelled" || reserved != 0 {
				t.Fatalf("sweeper did not recover token %s: status=%q reserved=%d err=%v", token, status, reserved, queryErr)
			}
		}

		durableData := append(phase3JPEG(t), 0)
		durableInspected, inspectErr := InspectWhiteboardRaster(durableData, "image/jpeg", phase3Hash(durableData))
		if inspectErr != nil {
			t.Fatal(inspectErr)
		}
		durableToken, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, durableInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		if _, stageErr := StageWhiteboardAsset(ctx, durableToken.Token, 41, durableInspected.ContentHash, "phase3-user", durableInspected, durableData); stageErr != nil {
			t.Fatal(stageErr)
		}
		if _, _, commitErr := CommitWhiteboardAssetStaging(ctx, durableToken.Token, 41, durableInspected.ContentHash, "phase3-user"); commitErr != nil {
			t.Fatal(commitErr)
		}
		fixture.mu.Lock()
		fixture.failDelete = true
		fixture.mu.Unlock()
		if cancelErr := CancelWhiteboardAssetStaging(ctx, durableToken.Token, 41, durableInspected.ContentHash, "phase3-user"); cancelErr == nil {
			t.Fatal("durable compensation failure must stay pending")
		}
		fixture.mu.Lock()
		fixture.failDelete = false
		fixture.mu.Unlock()
		if _, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging SET next_cleanup_at=now()-interval '1 minute' WHERE status='durable_cleanup_pending' AND content_hash=$1`, durableInspected.ContentHash); updateErr != nil {
			t.Fatal(updateErr)
		}
		result, sweepErr = worker.RunOnce(ctx)
		if sweepErr != nil || result.Cleaned < 1 {
			t.Fatalf("durable cleanup sweep failed: %#v %v", result, sweepErr)
		}
		if durable, lookupErr := GetWhiteboardAsset(ctx, 41, durableInspected.ContentHash); lookupErr != nil || durable != nil {
			t.Fatalf("durable sweep retained asset bytes: %#v %v", durable, lookupErr)
		}
		if queryErr := core.GetPool().QueryRow(ctx, `SELECT status FROM core.whiteboard_asset_staging WHERE token=$1`, durableToken.Token).Scan(&status); queryErr != nil || status != "compensated" {
			t.Fatalf("durable sweep did not terminalize committed token: %q %v", status, queryErr)
		}

		cancelled, prepareErr := PrepareWhiteboardAssetStaging(ctx, 41, stagedInspected.ContentHash, "phase3-user")
		if prepareErr != nil {
			t.Fatal(prepareErr)
		}
		cancelledCtx, cancel := context.WithCancel(ctx)
		cancel()
		if _, stageErr := StageWhiteboardAsset(cancelledCtx, cancelled.Token, 41, stagedInspected.ContentHash, "phase3-user", stagedInspected, stagedData); stageErr == nil {
			t.Fatal("cancelled stage request must fail")
		}
		if cancelErr := CancelWhiteboardAssetStaging(context.Background(), cancelled.Token, 41, stagedInspected.ContentHash, "phase3-user"); cancelErr != nil {
			t.Fatal(cancelErr)
		}
	})
	if err := DeleteWhiteboardAssetObjects(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if err := DeleteWhiteboardAssetObjects(ctx, []string{record.StorageKey, "forced-error"}); err == nil || !strings.Contains(err.Error(), "forced-error") {
		t.Fatalf("delete must aggregate object errors: %v", err)
	}

	if _, _, err := OpenWhiteboardAsset(ctx, record.StorageKey); err == nil {
		t.Fatal("deleted object must not open")
	}

	if _, err := core.GetPool().Exec(ctx, "DROP TABLE core.whiteboard_asset"); err != nil {
		t.Fatal(err)
	}
	if _, err := GetWhiteboardAsset(ctx, 41, inspected.ContentHash); err == nil {
		t.Fatal("lookup query errors must propagate")
	}
	if _, err := ListWhiteboardAssetStorageKeys(ctx, 41); err == nil {
		t.Fatal("list query errors must propagate")
	}
}

func TestWhiteboardAssetRollbackReferenceCountIsPageScoped(t *testing.T) {
	if !strings.Contains(whiteboardAssetReferenceCountQuery, "page_id = $1") ||
		!strings.Contains(whiteboardAssetReferenceCountQuery, "asset_id = $2") {
		t.Fatalf("rollback reference count is not page scoped: %s", whiteboardAssetReferenceCountQuery)
	}
}
