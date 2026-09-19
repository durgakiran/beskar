package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/durgakiran/beskar/quota"
	"github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Storage failures happen after real filesystem writes, so recovery assertions
// check actual orphan files rather than only an in-memory state machine.
type assetServiceTestStore struct {
	storage.Store
	beforePut    func(context.Context, string) error
	beforeExists func(context.Context, string) error
	afterPutErr  error
	deleteErr    error
}

func (s *assetServiceTestStore) Put(ctx context.Context, key string, body io.Reader, length int64, media string) error {
	if s.beforePut != nil {
		if err := s.beforePut(ctx, key); err != nil {
			return err
		}
	}
	if err := s.Store.Put(ctx, key, body, length, media); err != nil {
		return err
	}
	return s.afterPutErr
}
func (s *assetServiceTestStore) Exists(ctx context.Context, key string) (bool, error) {
	if s.beforeExists != nil {
		if err := s.beforeExists(ctx, key); err != nil {
			return false, err
		}
	}
	return s.Store.Exists(ctx, key)
}
func (s *assetServiceTestStore) Delete(ctx context.Context, key string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.Store.Delete(ctx, key)
}

type assetServiceTestFixture struct {
	t       *testing.T
	ctx     context.Context
	pool    *pgxpool.Pool
	in      whiteboardDraftInput
	account uuid.UUID
	base    uuid.UUID
	service *whiteboardAssetServiceV2
	store   *assetServiceTestStore
}

func (f *assetServiceTestFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.ctx, query, args...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *assetServiceTestFixture) scan(query string, args []any, dest ...any) {
	f.t.Helper()
	if err := f.pool.QueryRow(f.ctx, query, args...).Scan(dest...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *assetServiceTestFixture) prepare(data []byte) whiteboardAssetUploadResult {
	f.t.Helper()
	out, err := f.service.PrepareAsset(f.ctx, whiteboardAssetPrepareInput{whiteboardDraftInput: f.in, ContentHash: fmt.Sprintf("%x", sha256.Sum256(data)), ContentType: "image/png", ByteLength: int64(len(data)), IdempotencyKey: uuid.New()})
	if err != nil || out.State != "prepared" {
		f.t.Fatalf("prepare: %+v %v", out, err)
	}
	return out
}
func (f *assetServiceTestFixture) stage(data []byte) whiteboardAssetUploadResult {
	f.t.Helper()
	prepared := f.prepare(data)
	out, err := f.service.StageAsset(f.ctx, f.in, prepared.UploadID, "image/png", data)
	if err != nil || out.State != "staged" {
		f.t.Fatalf("stage: %+v %v", out, err)
	}
	return out
}
func (f *assetServiceTestFixture) commit(id uuid.UUID) whiteboardAssetUploadResult {
	f.t.Helper()
	for i := 0; i < 3; i++ {
		out, err := f.service.CommitAsset(f.ctx, f.in, id)
		if errors.Is(err, errWhiteboardAssetBusy) {
			continue
		}
		if err != nil || out.State != "committed" || out.Asset == nil {
			f.t.Fatalf("commit: %+v %v", out, err)
		}
		return out
	}
	f.t.Fatal("commit never resolved contention")
	return whiteboardAssetUploadResult{}
}
func (f *assetServiceTestFixture) usage(used, reserved int64, assets int) {
	f.t.Helper()
	var gotUsed, gotReserved, head int64
	var gotAssets int
	f.scan(`SELECT COALESCE((SELECT storage_bytes_used FROM billing.space_usage WHERE space_id=$1),0),COALESCE((SELECT storage_bytes_reserved FROM billing.space_usage WHERE space_id=$1),0),(SELECT count(*) FROM whiteboard.whiteboard_asset WHERE page_id=$2),COALESCE((SELECT head_sequence FROM whiteboard.whiteboard_draft WHERE page_id=$2),0)`, []any{f.in.SpaceID, f.in.PageID}, &gotUsed, &gotReserved, &gotAssets, &head)
	if gotUsed != used || gotReserved != reserved || gotAssets != assets || head != 0 {
		f.t.Fatalf("used=%d reserved=%d assets=%d head=%d; want %d/%d/%d/0", gotUsed, gotReserved, gotAssets, head, used, reserved, assets)
	}
}
func (f *assetServiceTestFixture) key(id uuid.UUID) string {
	f.t.Helper()
	var key string
	f.scan(`SELECT COALESCE(storage_key,'') FROM whiteboard.whiteboard_asset_upload WHERE id=$1`, []any{id}, &key)
	return key
}
func (f *assetServiceTestFixture) exists(key string, want bool) {
	f.t.Helper()
	exists, err := f.store.Store.Exists(f.ctx, key)
	if err != nil || exists != want {
		f.t.Fatalf("object %s: exists=%v want=%v error=%v", key, exists, want, err)
	}
}
func (f *assetServiceTestFixture) cleanup(maxAttempts int) whiteboardAssetCleanupResult {
	f.t.Helper()
	result, err := f.service.cleanupAssetPass(f.ctx, 100, maxAttempts)
	if err != nil {
		f.t.Fatal(err)
	}
	return result
}
func (f *assetServiceTestFixture) seedStale(data []byte, state string, expired bool) uuid.UUID {
	f.t.Helper()
	id, leaseID := uuid.New(), uuid.New()
	key := fmt.Sprintf("whiteboard-v2-assets/%d/uploads/%s/%s", f.in.PageID, id, leaseID)
	if err := f.store.Store.Put(f.ctx, key, bytes.NewReader(data), int64(len(data)), "image/png"); err != nil {
		f.t.Fatal(err)
	}
	tx, _, err := f.service.beginAsset(f.ctx, f.in, false)
	if err != nil {
		f.t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	reservation, err := quota.ReserveUploadCapacityTx(f.ctx, tx, f.in.PageID, int64(len(data)), "whiteboard_asset_v2", id.String(), nil)
	if err != nil {
		f.t.Fatal(err)
	}
	encoded, _ := json.Marshal(reservation)
	expires := time.Now().Add(time.Hour)
	if expired {
		expires = time.Now().Add(-time.Minute)
	}
	var lease any
	var leaseUntil any
	if state == "staging" {
		lease, leaseUntil = leaseID, time.Now().Add(-2*time.Minute)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	_, err = tx.Exec(f.ctx, `INSERT INTO whiteboard.whiteboard_asset_upload(id,page_id,actor_id,idempotency_key,request_hash,expected_hash,content_type,byte_length,state,storage_key,width,height,inspector_version,reservation,lease_id,lease_until,created_at,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,'image/png',$7,$8,$9,3,2,2,$10,$11,$12,now()-interval '2 hours',$13)`, id, f.in.PageID, f.in.ActorID, uuid.New(), "sha256:"+hash, hash, len(data), state, key, encoded, lease, leaseUntil, expires)
	if err != nil {
		f.t.Fatal(err)
	}
	if err = tx.Commit(f.ctx); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func assetServicePNG(t *testing.T, seed byte) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			im.SetRGBA(x, y, color.RGBA{R: seed, G: byte(x * 50), B: byte(y * 80), A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, im); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestWhiteboardAssetServiceV2Postgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_ASSET_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_ASSET_TEST_DSN to disposable whiteboard_assets_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_assets_test" {
		t.Fatal("requires disposable whiteboard_assets_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	fixture := assetServiceTestFixture{t: t, ctx: ctx, pool: pool}
	fixture.exec(`DROP TABLE IF EXISTS public.databasechangeloglock,public.databasechangelog;
 DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS billing CASCADE;
 CREATE SCHEMA core; CREATE SCHEMA billing;
 CREATE TABLE core.space(id uuid PRIMARY KEY,account_id uuid,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL REFERENCES core.space(id),owner_id uuid,parent_id bigint,type text DEFAULT 'whiteboard');
 CREATE TABLE core.asset_reference(asset_type text);
 CREATE TABLE billing.account_subscription(id uuid PRIMARY KEY,account_id uuid,plan_id uuid,status text,effective_from timestamptz,effective_to timestamptz,created_at timestamptz);
 CREATE TABLE billing.plan_limit(plan_id uuid,metric_key text,limit_value bigint);
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
	cmd := exec.CommandContext(ctx, "liquibase", "--defaults-file=/dev/null", "--search-path="+dir+","+root, "--changelog-file=test.xml", "--url=jdbc:postgresql://"+net.JoinHostPort(config.ConnConfig.Host, strconv.Itoa(int(config.ConnConfig.Port)))+"/whiteboard_assets_test", "--username="+config.ConnConfig.User, "update", "-Dapp_user="+pgx.Identifier{config.ConnConfig.User}.Sanitize())
	cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+config.ConnConfig.Password)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("migration: %v\n%s", err, out)
	}
	t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
	t.Setenv("QUOTA_STORAGE_BLOCKING_ENABLED", "true")
	t.Setenv("QUOTA_MONITOR_ONLY", "false")
	var nextPage int64
	newBoard := func(t *testing.T) *assetServiceTestFixture {
		t.Helper()
		nextPage++
		f := &assetServiceTestFixture{t: t, ctx: ctx, pool: pool, in: whiteboardDraftInput{PageID: nextPage, SpaceID: uuid.New(), ActorID: uuid.New()}, account: uuid.New(), base: uuid.New()}
		filesystem, err := storage.NewFilesystemStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		f.store = &assetServiceTestStore{Store: filesystem}
		f.service = &whiteboardAssetServiceV2{begin: pool.Begin, store: func(context.Context) (storage.Store, error) { return f.store, nil }}
		f.exec(`INSERT INTO core.space(id,account_id) VALUES($1,$2)`, f.in.SpaceID, f.account)
		f.exec(`INSERT INTO core.page(id,space_id,owner_id) VALUES($1,$2,$3)`, f.in.PageID, f.in.SpaceID, f.in.ActorID)
		f.exec(whiteboardV2InsertBoard, f.in.PageID, f.in.ActorID)
		f.exec(whiteboardV2InsertSnapshot, f.base, f.in.PageID, []byte{0, 0}, fmt.Sprintf("sha256:%x", sha256.Sum256([]byte{0, 0})), "Board", f.in.ActorID)
		f.exec(whiteboardV2InsertDraft, f.in.PageID, f.base, f.in.ActorID)
		return f
	}
	data := assetServicePNG(t, 10)
	size, hash := int64(len(data)), fmt.Sprintf("%x", sha256.Sum256(data))

	t.Run("scoped idempotency and independent durable lifecycle", func(t *testing.T) {
		f := newBoard(t)
		request := whiteboardAssetPrepareInput{whiteboardDraftInput: f.in, ContentHash: hash, ContentType: "image/png", ByteLength: size, IdempotencyKey: uuid.New()}
		prepared, err := f.service.PrepareAsset(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := f.service.PrepareAsset(ctx, request)
		if err != nil || replay.UploadID != prepared.UploadID {
			t.Fatalf("prepare replay: %+v %v", replay, err)
		}
		changed := request
		changed.ByteLength++
		if _, err = f.service.PrepareAsset(ctx, changed); !errors.Is(err, errWhiteboardV2KeyReuse) {
			t.Fatalf("changed idempotency payload: %v", err)
		}
		otherActor := f.in
		otherActor.ActorID = uuid.New()
		if _, err = f.service.GetAssetUpload(ctx, otherActor, prepared.UploadID); !errors.Is(err, errWhiteboardAssetNotFound) {
			t.Fatalf("actor scope: %v", err)
		}
		otherSpace := f.in
		otherSpace.SpaceID = uuid.New()
		if _, err = f.service.CancelAsset(ctx, otherSpace, prepared.UploadID); !errors.Is(err, errWhiteboardV2BoardNotFound) {
			t.Fatalf("space scope: %v", err)
		}
		otherBoard := newBoard(t)
		if _, err = otherBoard.service.GetAssetUpload(ctx, otherBoard.in, prepared.UploadID); !errors.Is(err, errWhiteboardAssetNotFound) {
			t.Fatalf("board scope: %v", err)
		}
		changed = request
		changed.ActorID = otherActor.ActorID
		owned, err := f.service.PrepareAsset(ctx, changed)
		if err != nil || owned.UploadID == prepared.UploadID {
			t.Fatalf("actor-scoped idempotency: %+v %v", owned, err)
		}
		if _, err = f.service.CancelAsset(ctx, otherActor, owned.UploadID); err != nil {
			t.Fatal(err)
		}
		f.usage(0, size, 0)
		if _, err = f.service.StageAsset(ctx, f.in, prepared.UploadID, "image/png", assetServicePNG(t, 99)); !errors.Is(err, errWhiteboardAssetInvalid) || f.key(prepared.UploadID) != "" {
			t.Fatalf("mismatched bytes changed staging: %v", err)
		}
		staged, err := f.service.StageAsset(ctx, f.in, prepared.UploadID, "image/png", data)
		if err != nil || staged.State != "staged" {
			t.Fatalf("stage: %+v %v", staged, err)
		}
		key := f.key(prepared.UploadID)
		if _, err = f.service.StageAsset(ctx, f.in, prepared.UploadID, "image/png", data); err != nil || f.key(prepared.UploadID) != key {
			t.Fatalf("stage replay replaced object: %v", err)
		}
		f.usage(0, size, 0)
		committed := f.commit(prepared.UploadID)
		replayed := f.commit(prepared.UploadID)
		if *committed.Asset != *replayed.Asset {
			t.Fatal("commit replay changed descriptor")
		}
		retained, err := f.service.CancelAsset(ctx, f.in, prepared.UploadID)
		if err != nil || !retained.Retained || retained.State != "committed" {
			t.Fatalf("committed cancellation: %+v %v", retained, err)
		}
		f.usage(size, 0, 1)
		opened, err := f.service.OpenAsset(ctx, f.in, hash, nil)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(opened.Content)
		opened.Content.Close()
		if err != nil || !bytes.Equal(body, data) || opened.Length != size {
			t.Fatal("original-byte download changed the file")
		}
	})

	t.Run("concurrent duplicate commits charge only one catalog insertion", func(t *testing.T) {
		f := newBoard(t)
		first, second := f.stage(data), f.stage(data)
		ids := []uuid.UUID{first.UploadID, second.UploadID}
		var wg sync.WaitGroup
		results := make(chan error, 2)
		for _, id := range ids {
			wg.Add(1)
			go func(id uuid.UUID) { defer wg.Done(); _, err := f.service.CommitAsset(ctx, f.in, id); results <- err }(id)
		}
		wg.Wait()
		close(results)
		for err := range results {
			if err != nil && !errors.Is(err, errWhiteboardAssetBusy) {
				t.Fatal(err)
			}
		}
		for _, id := range ids {
			f.commit(id)
		}
		f.usage(size, 0, 1)
		var commits, releases int
		f.scan(`SELECT count(*) FILTER(WHERE event_type='commit'),count(*) FILTER(WHERE event_type='release') FROM billing.space_usage_event WHERE space_id=$1`, []any{f.in.SpaceID}, &commits, &releases)
		if commits != 1 || releases != 1 {
			t.Fatalf("duplicate settlement events: commits=%d releases=%d", commits, releases)
		}
		var canonical string
		f.scan(`SELECT storage_key FROM whiteboard.whiteboard_asset WHERE page_id=$1`, []any{f.in.PageID}, &canonical)
		f.cleanup(8)
		f.exists(canonical, true)
		for _, id := range ids {
			if key := f.key(id); key != canonical {
				f.exists(key, false)
			}
		}
		other := newBoard(t)
		other.commit(other.stage(data).UploadID)
		other.usage(size, 0, 1)
	})

	t.Run("quota rejection leaves no receipt or reservation", func(t *testing.T) {
		f := newBoard(t)
		plan := uuid.New()
		f.exec(`INSERT INTO billing.account_subscription VALUES($1,$2,$3,'active',now(),NULL,now())`, uuid.New(), f.account, plan)
		f.exec(`INSERT INTO billing.plan_limit VALUES($1,'storage.bytes.total',$2)`, plan, size-1)
		_, err := f.service.PrepareAsset(ctx, whiteboardAssetPrepareInput{whiteboardDraftInput: f.in, ContentHash: hash, ContentType: "image/png", ByteLength: size, IdempotencyKey: uuid.New()})
		if !errors.Is(err, quota.ErrAccountStorageLimitExceeded) {
			t.Fatalf("quota rejection: %v", err)
		}
		var count int
		f.scan(`SELECT count(*) FROM whiteboard.whiteboard_asset_upload WHERE page_id=$1`, []any{f.in.PageID}, &count)
		if count != 0 {
			t.Fatal("rejected prepare retained an upload")
		}
		f.usage(0, 0, 0)
	})

	t.Run("failed writes keep durable cleanup and retry with a new key", func(t *testing.T) {
		f := newBoard(t)
		upload := f.prepare(data)
		f.store.afterPutErr = errors.New("write succeeded but response failed")
		if _, err := f.service.StageAsset(ctx, f.in, upload.UploadID, "image/png", data); !errors.Is(err, errWhiteboardAssetUnavailable) {
			t.Fatalf("failed write: %v", err)
		}
		var oldKey string
		f.scan(`SELECT storage_key FROM whiteboard.whiteboard_asset_cleanup WHERE page_id=$1`, []any{f.in.PageID}, &oldKey)
		f.exists(oldKey, true)
		if f.key(upload.UploadID) != "" {
			t.Fatal("failed write remained eligible for commit")
		}
		f.usage(0, size, 0)
		f.store.afterPutErr = nil
		if _, err := f.service.StageAsset(ctx, f.in, upload.UploadID, "image/png", data); err != nil {
			t.Fatal(err)
		}
		newKey := f.key(upload.UploadID)
		if newKey == oldKey {
			t.Fatal("retry reused a cleanup target")
		}
		f.commit(upload.UploadID)
		f.exec(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now() WHERE page_id=$1`, f.in.PageID)
		f.cleanup(8)
		f.exists(oldKey, false)
		f.exists(newKey, true)
		f.usage(size, 0, 1)
	})

	t.Run("cancel wins during commit storage confirmation", func(t *testing.T) {
		f := newBoard(t)
		upload := f.stage(data)
		checking, resume := make(chan struct{}), make(chan struct{})
		f.store.beforeExists = func(ctx context.Context, _ string) error {
			close(checking)
			select {
			case <-resume:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		done := make(chan error, 1)
		go func() { _, err := f.service.CommitAsset(ctx, f.in, upload.UploadID); done <- err }()
		<-checking
		cancelled, err := f.service.CancelAsset(ctx, f.in, upload.UploadID)
		close(resume)
		if err != nil || cancelled.State != "cancelled" || !cancelled.CleanupPending {
			t.Fatalf("cancel during confirmation: %+v %v", cancelled, err)
		}
		if err = <-done; !errors.Is(err, errWhiteboardAssetConflict) {
			t.Fatalf("late commit: %v", err)
		}
		f.usage(0, 0, 0)
		f.cleanup(8)
		f.exists(f.key(upload.UploadID), false)
		if _, err = f.service.CancelAsset(ctx, f.in, upload.UploadID); err != nil {
			t.Fatal(err)
		}
		f.usage(0, 0, 0)
	})

	for _, deleteBoard := range []bool{false, true} {
		name := "cancel"
		if deleteBoard {
			name = "delete"
		}
		t.Run(name+" during delayed writer preserves cleanup fence", func(t *testing.T) {
			f := newBoard(t)
			upload := f.prepare(data)
			writing, resume := make(chan string, 1), make(chan struct{})
			f.store.beforePut = func(ctx context.Context, key string) error {
				writing <- key
				select {
				case <-resume:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			done := make(chan error, 1)
			go func() { _, err := f.service.StageAsset(ctx, f.in, upload.UploadID, "image/png", data); done <- err }()
			key := <-writing
			if f.key(upload.UploadID) != key {
				t.Fatal("writer key was not durable before Put")
			}
			if deleteBoard {
				history := whiteboardServiceV2{begin: pool.Begin}
				err = history.DeleteWhiteboardV2(ctx, f.in)
			} else {
				_, err = f.service.CancelAsset(ctx, f.in, upload.UploadID)
			}
			if err != nil {
				close(resume)
				t.Fatal(err)
			}
			var notBefore, leaseUntil time.Time
			f.scan(`SELECT not_before FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &notBefore)
			if !notBefore.After(time.Now().Add(whiteboardAssetWriteGrace)) {
				t.Fatal("cleanup did not preserve the active write lease")
			}
			f.cleanup(8)
			f.scan(`SELECT not_before FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &leaseUntil)
			if leaseUntil != notBefore {
				t.Fatal("worker changed an ineligible cleanup target")
			}
			// Simulate a cleanup worker finishing after its lease clock elapsed,
			// while a misbehaving storage writer still has not returned.
			f.exec(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now() WHERE page_id=$1`, f.in.PageID)
			f.cleanup(8)
			var completed *time.Time
			f.scan(`SELECT completed_at FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &completed)
			if completed == nil {
				t.Fatal("fixture did not complete cleanup before the late write")
			}
			close(resume)
			lateErr := <-done
			if !errors.Is(lateErr, errWhiteboardAssetConflict) && !errors.Is(lateErr, errWhiteboardV2BoardNotFound) {
				t.Fatalf("late writer finalized after %s: %v", name, lateErr)
			}
			f.exists(key, true)
			f.usage(0, 0, 0)
			f.scan(`SELECT completed_at,not_before FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &completed, &notBefore)
			if completed != nil || !notBefore.After(time.Now()) {
				t.Fatal("late writer did not rearm its completed cleanup job")
			}
			// The writer has returned, so advance only this fixture's retry clock.
			f.exec(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now() WHERE page_id=$1`, f.in.PageID)
			f.cleanup(8)
			f.exists(key, false)
			f.usage(0, 0, 0)
		})
	}

	t.Run("expiry abandoned leases and deleted spaces recover durable reservations", func(t *testing.T) {
		f := newBoard(t)
		expired := f.seedStale(data, "staged", true)
		key := f.key(expired)
		result := f.cleanup(8)
		if result.Expired < 1 {
			t.Fatal("expired session was not reclaimed")
		}
		f.usage(0, 0, 0)
		f.exists(key, false)
		status, err := f.service.GetAssetUpload(ctx, f.in, expired)
		if err != nil || status.State != "expired" {
			t.Fatalf("expired receipt: %+v %v", status, err)
		}
		stale := f.seedStale(data, "staging", false)
		key = f.key(stale)
		if result = f.cleanup(8); result.Recovered < 1 {
			t.Fatal("abandoned lease did not become retryable")
		}
		f.usage(0, size, 0)
		f.exists(key, false)
		if f.key(stale) != "" {
			t.Fatal("recovered receipt still owns old object")
		}
		if _, err = f.service.StageAsset(ctx, f.in, stale, "image/png", data); err != nil {
			t.Fatal(err)
		}
		f.commit(stale)
		f.usage(size, 0, 1)
		deleted := newBoard(t)
		upload := deleted.prepare(data)
		deleted.exec(`UPDATE core.space SET deleted_at=now() WHERE id=$1`, deleted.in.SpaceID)
		if result = deleted.cleanup(8); result.Expired < 1 {
			t.Fatal("deleted space reservation was not reclaimed")
		}
		deleted.usage(0, 0, 0)
		var state string
		deleted.scan(`SELECT state FROM whiteboard.whiteboard_asset_upload WHERE id=$1`, []any{upload.UploadID}, &state)
		if state != "expired" {
			t.Fatal("deleted space upload remained active")
		}
	})

	t.Run("cleanup retries back off and expose exhausted work", func(t *testing.T) {
		f := newBoard(t)
		upload := f.stage(data)
		key := f.key(upload.UploadID)
		if _, err := f.service.CancelAsset(ctx, f.in, upload.UploadID); err != nil {
			t.Fatal(err)
		}
		f.store.deleteErr = errors.New("object store unavailable\x00" + strings.Repeat("界", 1000))
		result := f.cleanup(2)
		if result.Failed < 1 {
			t.Fatal("cleanup failure was not reported")
		}
		var attempts int
		var next time.Time
		var message string
		var exhausted *time.Time
		f.scan(`SELECT attempt_count,not_before,last_error,exhausted_at FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &attempts, &next, &message, &exhausted)
		if attempts != 1 || !next.After(time.Now()) || message == "" || exhausted != nil {
			t.Fatal("cleanup failed to persist bounded retry state")
		}
		f.cleanup(2)
		f.scan(`SELECT attempt_count FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &attempts)
		if attempts != 1 {
			t.Fatal("cleanup retried before backoff elapsed")
		}
		f.exec(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now() WHERE storage_key=$1`, key)
		if result = f.cleanup(2); result.Exhausted < 1 {
			t.Fatal("last failed attempt did not become exhausted")
		}
		f.scan(`SELECT attempt_count,exhausted_at FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, []any{key}, &attempts, &exhausted)
		if attempts != 2 || exhausted == nil {
			t.Fatal("exhausted cleanup was not observable")
		}
		f.usage(0, 0, 0)
		f.exists(key, true)
	})

	t.Run("archived boards permit committed replay reads and cancellation", func(t *testing.T) {
		f := newBoard(t)
		committedUpload, pending := f.stage(data), f.prepare(data)
		f.commit(committedUpload.UploadID)
		f.exec(`UPDATE core.space SET archived_at=now() WHERE id=$1`, f.in.SpaceID)
		f.commit(committedUpload.UploadID)
		if _, err := f.service.StageAsset(ctx, f.in, committedUpload.UploadID, "image/png", data); err != nil {
			t.Fatal(err)
		}
		var key uuid.UUID
		f.scan(`SELECT idempotency_key FROM whiteboard.whiteboard_asset_upload WHERE id=$1`, []any{committedUpload.UploadID}, &key)
		request := whiteboardAssetPrepareInput{whiteboardDraftInput: f.in, ContentHash: hash, ContentType: "image/png", ByteLength: size, IdempotencyKey: key}
		if _, err := f.service.PrepareAsset(ctx, request); err != nil {
			t.Fatal(err)
		}
		request.IdempotencyKey = uuid.New()
		if _, err := f.service.PrepareAsset(ctx, request); !errors.Is(err, errWhiteboardV2Archived) {
			t.Fatalf("archived prepare: %v", err)
		}
		if _, err := f.service.StageAsset(ctx, f.in, pending.UploadID, "image/png", data); !errors.Is(err, errWhiteboardV2Archived) {
			t.Fatalf("archived stage: %v", err)
		}
		if _, err := f.service.CommitAsset(ctx, f.in, pending.UploadID); !errors.Is(err, errWhiteboardV2Archived) {
			t.Fatalf("archived commit: %v", err)
		}
		if _, err := f.service.CancelAsset(ctx, f.in, pending.UploadID); err != nil {
			t.Fatal(err)
		}
		opened, err := f.service.OpenAsset(ctx, f.in, hash, nil)
		if err != nil {
			t.Fatal(err)
		}
		opened.Content.Close()
		f.usage(size, 0, 1)
	})

	t.Run("version reads require inspected membership and fail on missing storage", func(t *testing.T) {
		f := newBoard(t)
		upload := f.stage(data)
		f.commit(upload.UploadID)
		version := uuid.New()
		f.exec(whiteboardV2PublishVersion, version, f.in.PageID, f.base, f.in.ActorID, uuid.New())
		if _, err := f.service.OpenAsset(ctx, f.in, hash, &version); !errors.Is(err, errWhiteboardAssetNotFound) {
			t.Fatalf("uninspected snapshot granted read: %v", err)
		}
		f.exec(`INSERT INTO whiteboard.whiteboard_snapshot_asset_manifest(snapshot_id,page_id,state_digest,extractor_version) SELECT id,page_id,state_digest,'glideboard-assets-v1' FROM whiteboard.whiteboard_snapshot WHERE id=$1`, f.base)
		if _, err := f.service.OpenAsset(ctx, f.in, hash, &version); !errors.Is(err, errWhiteboardAssetNotFound) {
			t.Fatalf("draft-only asset granted read: %v", err)
		}
		f.exec(`INSERT INTO whiteboard.whiteboard_snapshot_asset(snapshot_id,page_id,content_hash) VALUES($1,$2,$3)`, f.base, f.in.PageID, hash)
		opened, err := f.service.OpenAsset(ctx, f.in, hash, &version)
		if err != nil {
			t.Fatal(err)
		}
		opened.Content.Close()
		key := f.key(upload.UploadID)
		f.exec(`INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,storage_key,reason) VALUES($1,$2,$3,$4,'stale-intent')`, uuid.New(), f.in.PageID, f.in.SpaceID, key)
		f.cleanup(8)
		f.exists(key, true)
		if err := f.store.Store.Delete(ctx, key); err != nil {
			t.Fatal(err)
		}
		if _, err := f.service.OpenAsset(ctx, f.in, hash, &version); !errors.Is(err, errWhiteboardAssetUnavailable) {
			t.Fatalf("missing catalog object did not fail observably: %v", err)
		}
	})
}
