package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/durgakiran/beskar/core"
	media "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"
	"github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWhiteboardAssetDeletionV2Postgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_ASSET_ACCOUNTING_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_ASSET_ACCOUNTING_TEST_DSN to disposable whiteboard_asset_accounting_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_asset_accounting_test" {
		t.Fatal("requires disposable whiteboard_asset_accounting_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	execute := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	execute(`DROP TABLE IF EXISTS public.databasechangeloglock,public.databasechangelog;
 DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS billing CASCADE;
 CREATE SCHEMA core; CREATE SCHEMA billing;
 CREATE TABLE core.space(id uuid PRIMARY KEY,account_id uuid,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL REFERENCES core.space(id),owner_id uuid,parent_id bigint,type text DEFAULT 'whiteboard');
 CREATE TABLE core.asset_reference(asset_type text);
 CREATE TABLE billing.space_usage(space_id uuid PRIMARY KEY,storage_bytes_used bigint NOT NULL,storage_bytes_reserved bigint NOT NULL,updated_at timestamptz);
 CREATE TABLE billing.space_usage_event(space_id uuid,metric_key text,event_type text,delta_value bigint,source_type text,source_id text,correlation_id text,metadata jsonb,created_at timestamptz);`)
	root, err := filepath.Abs("../../db/beskar")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	changelog := `<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd"><include file="updates/whiteboard_creation.xml"/><include file="updates/whiteboard_updates.xml"/><include file="updates/whiteboard_publication.xml"/><include file="updates/whiteboard_previews.xml"/><include file="updates/whiteboard_titles.xml"/><include file="updates/whiteboard_draft_replay.xml"/><include file="updates/whiteboard_history.xml"/><include file="updates/whiteboard_assets.xml"/><include file="updates/whiteboard_assets_v2.xml"/><include file="updates/whiteboard_assets_v2_legacy_cleanup.xml"/></databaseChangeLog>`
	if err = os.WriteFile(filepath.Join(dir, "test.xml"), []byte(changelog), 0600); err != nil {
		t.Fatal(err)
	}
	migrate := func(command ...string) {
		t.Helper()
		args := []string{"--defaults-file=/dev/null", "--search-path=" + dir + "," + root, "--changelog-file=test.xml", "--url=jdbc:postgresql://" + net.JoinHostPort(config.ConnConfig.Host, strconv.Itoa(int(config.ConnConfig.Port))) + "/whiteboard_asset_accounting_test", "--username=" + config.ConnConfig.User}
		args = append(args, command...)
		args = append(args, "-Dapp_user="+pgx.Identifier{config.ConnConfig.User}.Sanitize())
		cmd := exec.CommandContext(ctx, "liquibase", args...)
		cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+config.ConnConfig.Password)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("migration %v: %v\n%s", command, err, out)
		}
	}
	migrate("update")
	migrate("rollback-count", "--count=1")
	migrate("update")
	t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
	in := whiteboardDraftInput{PageID: 42, SpaceID: uuid.New(), ActorID: uuid.New()}
	account, snapshot := uuid.New(), uuid.New()
	empty := []byte{0, 0}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(empty))
	execute(`INSERT INTO core.space(id,account_id) VALUES($1,$2)`, in.SpaceID, account)
	execute(`INSERT INTO core.page(id,space_id,owner_id) VALUES(42,$1,$2)`, in.SpaceID, in.ActorID)
	execute(whiteboardV2InsertBoard, in.PageID, in.ActorID)
	execute(whiteboardV2InsertSnapshot, snapshot, in.PageID, empty, digest, "Board", in.ActorID)
	execute(whiteboardV2InsertDraft, in.PageID, snapshot, in.ActorID)
	assetKey, secondKey := "whiteboard-v2-assets/42/committed-one", "whiteboard-v2-assets/42/committed-two"
	execute(`INSERT INTO whiteboard.whiteboard_asset(page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,inspector_version)
 VALUES(42,$1,$2,100,'image/png',10,10,$5,1),(42,$3,$4,60,'image/png',10,6,$5,1)`, strings.Repeat("a", 64), assetKey, strings.Repeat("b", 64), secondKey, in.ActorID)
	execute(`INSERT INTO whiteboard.whiteboard_snapshot_asset(snapshot_id,page_id,content_hash) VALUES($1,42,$2)`, snapshot, strings.Repeat("a", 64))
	execute(`INSERT INTO whiteboard.whiteboard_snapshot_asset_manifest(snapshot_id,page_id,state_digest,extractor_version) VALUES($1,42,$2,'test')`, snapshot, digest)
	leaseUntil := time.Now().UTC().Add(3 * time.Minute).Truncate(time.Microsecond)
	stagedKey, uploadingKey, cancelledKey := "whiteboard-v2-assets/42/staged", "whiteboard-v2-assets/42/uploading", "whiteboard-v2-assets/42/cancelled"
	insertUpload := func(state, key string, bytes int64, reserve bool, lease *time.Time) {
		t.Helper()
		id := uuid.New()
		reservation := quota.UploadReservation{}
		if reserve {
			reservation = quota.UploadReservation{AccountID: account, SpaceID: in.SpaceID, ReservedBytes: bytes, SourceType: "whiteboard_asset_v2", SourceID: id.String(), CorrelationID: uuid.NewString()}
		}
		encoded, err := json.Marshal(reservation)
		if err != nil {
			t.Fatal(err)
		}
		var leaseID *uuid.UUID
		if lease != nil {
			value := uuid.New()
			leaseID = &value
		}
		execute(`INSERT INTO whiteboard.whiteboard_asset_upload(id,page_id,actor_id,idempotency_key,request_hash,expected_hash,content_type,byte_length,state,storage_key,reservation,lease_until,lease_id,width,height,inspector_version,expires_at)
 VALUES($1,42,$2,$3,$4,$5,'image/png',$6,$7,$8,$9,$10,$11,10,10,1,now()+interval '1 hour')`, id, in.ActorID, uuid.New(), "sha256:"+strings.Repeat("c", 64), strings.Repeat("a", 64), bytes, state, key, encoded, lease, leaseID)
	}
	insertUpload("staged", stagedKey, 32, true, nil)
	insertUpload("staging", uploadingKey, 48, true, &leaseUntil)
	insertUpload("committed", assetKey, 100, false, nil)
	insertUpload("cancelled", cancelledKey, 20, false, nil)
	legacyKey := storage.WhiteboardAssetObjectKey(42, strings.Repeat("a", 64))
	legacySecondKey := storage.WhiteboardAssetObjectKey(42, strings.Repeat("e", 64))
	legacyStagedKey := storage.WhiteboardAssetObjectKey(42, strings.Repeat("f", 64))
	legacyUploadingKey := storage.WhiteboardAssetObjectKey(42, strings.Repeat("0", 64))
	legacyCancelledKey := storage.WhiteboardAssetObjectKey(42, strings.Repeat("1", 64))
	execute(`INSERT INTO core.whiteboard_asset(page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,inspector_version)
 VALUES(42,$1,$2,100,'image/png',10,10,$5,1),(42,$3,$4,23,'image/png',1,1,$5,1)`, strings.Repeat("a", 64), legacyKey, strings.Repeat("e", 64), legacySecondKey, in.ActorID.String())
	insertLegacyUpload := func(state, key string, size int64, reserved int64) {
		t.Helper()
		execute(`INSERT INTO core.whiteboard_asset_staging(token,page_id,content_hash,storage_key,created_by,status,file_size,quota_account_id,quota_space_id,quota_reserved_bytes,quota_correlation_id)
 VALUES($1,42,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, uuid.New(), key[len("whiteboard-assets/42/sha256/"):], key, in.ActorID.String(), state, size, account, in.SpaceID, reserved, uuid.NewString())
	}
	insertLegacyUpload("staged", legacyStagedKey, 30, 30)
	insertLegacyUpload("uploading", legacyUploadingKey, 90, 90)
	insertLegacyUpload("committed", legacyKey, 100, 0)
	insertLegacyUpload("cancelled", legacyCancelledKey, 20, 0)
	execute(`INSERT INTO billing.space_usage VALUES($1,323,200,now())`, in.SpaceID)
	// A deterministic legacy key can have an old completed receipt. Logical
	// deletion must rearm it and collapse repeated catalog/staging references.
	execute(`INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,account_id,storage_key,byte_count,reason,completed_at)
 VALUES($1,42,$2,$3,$4,100,'board_deleted',now()),($5,42,$2,$3,$6,30,'board_deleted',NULL)`, uuid.New(), in.SpaceID, account, legacyKey, uuid.New(), legacyStagedKey)
	filesystem, err := storage.NewFilesystemStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	allKeys := []string{assetKey, secondKey, stagedKey, uploadingKey, cancelledKey, legacyKey, legacySecondKey, legacyStagedKey, legacyUploadingKey, legacyCancelledKey}
	for _, key := range allKeys {
		if err := filesystem.Put(ctx, key, bytes.NewReader([]byte("object")), 6, "image/png"); err != nil {
			t.Fatal(err)
		}
	}
	worker := &whiteboardAssetServiceV2{begin: pool.Begin, store: func(context.Context) (storage.Store, error) { return filesystem, nil }}
	// A prior cleanup intent for the active writer must be postponed past its
	// write lease rather than leaving an early deletion racing the upload.
	execute(`INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,account_id,storage_key,byte_count,reason,not_before)
 VALUES($1,42,$2,$3,$4,48,'cancelled',now()-interval '1 minute')`, uuid.New(), in.SpaceID, account, uploadingKey)
	service := &whiteboardServiceV2{begin: func(ctx context.Context) (pgx.Tx, error) { return pool.Begin(ctx) }}
	tx, err := service.beginHistoryWrite(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if err = queueWhiteboardAssetDeletionV2(ctx, tx, in); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	assertState := func(wantAssets, wantUploads, wantJobs int, wantUsed, wantReserved int64) {
		t.Helper()
		var assets, uploads, jobs int
		var used, reserved int64
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM whiteboard.whiteboard_asset),(SELECT count(*) FROM whiteboard.whiteboard_asset_upload),(SELECT count(*) FROM whiteboard.whiteboard_asset_cleanup),storage_bytes_used,storage_bytes_reserved FROM billing.space_usage WHERE space_id=$1`, in.SpaceID).Scan(&assets, &uploads, &jobs, &used, &reserved); err != nil {
			t.Fatal(err)
		}
		if assets != wantAssets || uploads != wantUploads || jobs != wantJobs || used != wantUsed || reserved != wantReserved {
			t.Fatalf("deletion state: assets=%d uploads=%d jobs=%d used=%d reserved=%d", assets, uploads, jobs, used, reserved)
		}
	}
	assertState(2, 4, 3, 323, 200)
	// Cleanup never touches legacy keys while their page survives, including
	// soft-deleted spaces whose committed documents remain retained.
	for _, deleted := range []bool{false, true} {
		execute(`UPDATE core.space SET deleted_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1`, in.SpaceID, deleted)
		claimed, _, _, err := worker.cleanupAssetObject(ctx, 8)
		if err != nil || claimed {
			t.Fatalf("live legacy cleanup claimed=%v: %v", claimed, err)
		}
	}
	execute(`UPDATE core.space SET deleted_at=NULL WHERE id=$1`, in.SpaceID)
	// A legacy staged transfer owns both the advisory lock and its receipt while
	// writing. Deletion must fail safely instead of cascading that receipt early.
	writer, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = writer.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "42:"+strings.Repeat("0", 64)); err != nil {
		t.Fatal(err)
	}
	shortCtx, shortCancel := context.WithTimeout(ctx, 150*time.Millisecond)
	deleteErr := service.DeleteWhiteboardV2(shortCtx, in)
	shortCancel()
	if deleteErr == nil {
		t.Fatal("deletion passed an active legacy writer")
	}
	if err = writer.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	assertState(2, 4, 3, 323, 200)
	if err = service.DeleteWhiteboardV2(ctx, in); err != nil {
		t.Fatal(err)
	}
	assertState(0, 0, 10, 40, 0)
	var boardCount, associationCount, manifestCount, events int
	var notBefore time.Time
	var cleanupSpace, cleanupAccount uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM core.page),(SELECT count(*) FROM whiteboard.whiteboard_snapshot_asset),(SELECT count(*) FROM whiteboard.whiteboard_snapshot_asset_manifest),(SELECT count(*) FROM billing.space_usage_event)`).Scan(&boardCount, &associationCount, &manifestCount, &events); err != nil {
		t.Fatal(err)
	}
	if boardCount != 0 || associationCount != 0 || manifestCount != 0 || events != 5 {
		t.Fatalf("deleted dependencies or exactly-once quota: board=%d associations=%d manifests=%d events=%d", boardCount, associationCount, manifestCount, events)
	}
	if err = pool.QueryRow(ctx, `SELECT not_before,space_id,account_id FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, uploadingKey).Scan(&notBefore, &cleanupSpace, &cleanupAccount); err != nil {
		t.Fatal(err)
	}
	if notBefore.Before(leaseUntil.Add(whiteboardAssetWriteGrace)) || cleanupSpace != in.SpaceID || cleanupAccount != account {
		t.Fatal("cleanup lost the writer fence or former ownership")
	}
	if err = service.DeleteWhiteboardV2(ctx, in); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("delete retry: %v", err)
	}
	assertState(0, 0, 10, 40, 0)
	var legacyAssets, legacyUploads int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM core.whiteboard_asset),(SELECT count(*) FROM core.whiteboard_asset_staging)`).Scan(&legacyAssets, &legacyUploads); err != nil || legacyAssets != 0 || legacyUploads != 0 {
		t.Fatalf("legacy rows survived: assets=%d uploads=%d err=%v", legacyAssets, legacyUploads, err)
	}
	// Advance only this disposable test's cleanup deadlines. The production
	// deadline assertion above covers the active v2 writer grace.
	execute(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now()-interval '1 second'`)
	cleaned, err := worker.cleanupAssetPass(ctx, 100, 8)
	if err != nil || cleaned.Deleted != len(allKeys) {
		t.Fatalf("physical cleanup: %+v %v", cleaned, err)
	}
	for _, key := range allKeys {
		if exists, err := filesystem.Exists(ctx, key); err != nil || exists {
			t.Fatalf("orphan survived: %s exists=%v err=%v", key, exists, err)
		}
	}
	cleaned, err = worker.cleanupAssetPass(ctx, 100, 8)
	if err != nil || cleaned.Deleted != 0 {
		t.Fatalf("cleanup retry: %+v %v", cleaned, err)
	}
	assertState(0, 0, 10, 40, 0)
	// Isolate the legacy service's process-global pool and S3 runtime from other
	// opt-in integration suites that can use a different disposable database.
	probe := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWhiteboardLegacySaveDeletionFenceProbe$", "-test.v")
	probe.Env = append(os.Environ(), "WHITEBOARD_ASSET_DELETE_PROBE=1", "PG_HOST="+config.ConnConfig.Host, "PG_PORT="+strconv.Itoa(int(config.ConnConfig.Port)), "PG_USER="+config.ConnConfig.User, "PG_PASSWORD="+config.ConnConfig.Password, "PG_DB=whiteboard_asset_accounting_test")
	if out, err := probe.CombinedOutput(); err != nil {
		t.Fatalf("legacy save deletion fence: %v\n%s", err, out)
	}
}

func TestWhiteboardLegacySaveDeletionFenceProbe(t *testing.T) {
	if os.Getenv("WHITEBOARD_ASSET_DELETE_PROBE") != "1" || os.Getenv("PG_DB") != "whiteboard_asset_accounting_test" {
		t.Skip("isolated subprocess of the deletion integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool := core.GetPool()
	var database string
	if err := pool.QueryRow(ctx, `SELECT current_database()`).Scan(&database); err != nil || database != "whiteboard_asset_accounting_test" {
		t.Fatalf("requires disposable deletion database: %s %v", database, err)
	}
	t.Setenv("QUOTA_SYSTEM_ENABLED", "false")
	in := whiteboardDraftInput{PageID: 43, SpaceID: uuid.New(), ActorID: uuid.New()}
	for _, item := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO core.space(id) VALUES($1)`, []any{in.SpaceID}},
		{`INSERT INTO core.page(id,space_id,owner_id) VALUES($1,$2,$3)`, []any{in.PageID, in.SpaceID, in.ActorID}},
		{whiteboardV2InsertBoard, []any{in.PageID, in.ActorID}},
	} {
		if _, err := pool.Exec(ctx, item.query, item.args...); err != nil {
			t.Fatal(err)
		}
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	var mutex sync.Mutex
	objects := map[string][]byte{}
	puts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				w.WriteHeader(500)
				return
			}
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				w.WriteHeader(500)
				return
			}
			mutex.Lock()
			objects[r.URL.Path] = body
			puts++
			mutex.Unlock()
			w.Header().Set("ETag", `"test"`)
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		switch r.Method {
		case http.MethodHead:
			if body, ok := objects[r.URL.Path]; ok {
				w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			} else {
				w.Header().Set("x-amz-error-code", "NoSuchKey")
				w.WriteHeader(404)
			}
		case http.MethodDelete:
			delete(objects, r.URL.Path)
			w.WriteHeader(204)
		default:
			w.WriteHeader(405)
		}
	}))
	defer server.Close()
	defer unblock()
	for key, value := range map[string]string{"STORAGE_S3_BUCKET": "deletion-test", "STORAGE_S3_ENDPOINT": server.URL, "STORAGE_S3_REGION": "test", "STORAGE_S3_ACCESS_KEY_ID": "test", "STORAGE_S3_SECRET_ACCESS_KEY": "test", "STORAGE_S3_PREFIX": ""} {
		t.Setenv(key, value)
	}
	storage.ResetForTest()
	defer storage.ResetForTest()
	data := assetServicePNG(t, 53)
	inspected, err := media.InspectWhiteboardRaster(data, "image/png", fmt.Sprintf("%x", sha256.Sum256(data)))
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		_, _, err := media.SaveWhiteboardAsset(ctx, quota.UploadReservation{}, in.PageID, in.ActorID.String(), inspected, data)
		finished <- err
	}()
	select {
	case <-entered:
	case err := <-finished:
		t.Fatalf("save before Put: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	history := &whiteboardServiceV2{begin: pool.Begin}
	shortCtx, shortCancel := context.WithTimeout(ctx, 150*time.Millisecond)
	err = history.DeleteWhiteboardV2(shortCtx, in)
	shortCancel()
	if err == nil {
		t.Fatal("deletion passed a transferring direct legacy upload")
	}
	unblock()
	if err = <-finished; err != nil {
		t.Fatal(err)
	}
	if err = history.DeleteWhiteboardV2(ctx, in); err != nil {
		t.Fatal(err)
	}
	worker := &whiteboardAssetServiceV2{begin: pool.Begin, store: storage.RuntimeStore}
	if result, err := worker.cleanupAssetPass(ctx, 100, 8); err != nil || result.Deleted != 1 {
		t.Fatalf("legacy physical cleanup: %+v %v", result, err)
	}
	if _, _, err = media.SaveWhiteboardAsset(ctx, quota.UploadReservation{}, in.PageID, in.ActorID.String(), inspected, data); err == nil {
		t.Fatal("direct legacy upload wrote after page deletion")
	}
	mutex.Lock()
	defer mutex.Unlock()
	if len(objects) != 0 || puts != 1 {
		t.Fatalf("unexpected legacy storage after deletion: objects=%d puts=%d", len(objects), puts)
	}
}
