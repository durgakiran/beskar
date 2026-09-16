package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	media "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"
	"github.com/durgakiran/beskar/storage"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in and destructive only to the explicitly named disposable database.
func TestWhiteboardMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_MIGRATION_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_MIGRATION_TEST_DSN to disposable whiteboard_migration_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_migration_test" {
		t.Fatal("requires disposable whiteboard_migration_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	sql := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	sql(`DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS billing CASCADE; DROP TABLE IF EXISTS public.databasechangelog,public.databasechangeloglock;
 CREATE SCHEMA core; CREATE SCHEMA billing;
 CREATE TABLE core.space(id uuid PRIMARY KEY,account_id uuid,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid REFERENCES core.space(id),owner_id uuid,date_created timestamptz,parent_id bigint,type text);
 CREATE TABLE core.page_doc_map(doc_id bigint PRIMARY KEY,page_id bigint REFERENCES core.page(id) ON DELETE CASCADE,title text,draft integer,version timestamptz);
 CREATE TABLE core.whiteboard_data(doc_id bigint PRIMARY KEY REFERENCES core.page_doc_map(doc_id) ON DELETE CASCADE,data bytea,revision bigint DEFAULT 0,server_update_sequence bigint DEFAULT 0,preview_asset_name text);
 CREATE TABLE core.attachment(page_id bigint,deleted_at timestamptz);
 CREATE TABLE core.image_asset(page_id bigint,deleted_at timestamptz);
 CREATE TABLE billing.account_subscription(id uuid PRIMARY KEY,account_id uuid,plan_id uuid,status text,effective_from timestamptz,effective_to timestamptz,created_at timestamptz);
 CREATE TABLE billing.plan_limit(plan_id uuid,metric_key text,limit_value bigint);
 CREATE TABLE billing.space_usage(space_id uuid PRIMARY KEY,storage_bytes_used bigint NOT NULL,storage_bytes_reserved bigint NOT NULL,updated_at timestamptz);
 CREATE TABLE billing.space_usage_event(space_id uuid,metric_key text,event_type text,delta_value bigint,source_type text,source_id text,correlation_id text,metadata jsonb,created_at timestamptz);`)
	root, _ := filepath.Abs("../../db/beskar")
	dir := t.TempDir()
	changelog := `<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">`
	changelog += `<include file="updates/asset_references.xml"/><include file="updates/asset_reference_hardening.xml"/>`
	for _, name := range []string{"creation", "updates", "publication", "previews", "titles", "draft_replay", "history", "migration", "assets", "assets_v2"} {
		changelog += `<include file="updates/whiteboard_` + name + `.xml"/>`
	}
	changelog += `</databaseChangeLog>`
	if err = os.WriteFile(filepath.Join(dir, "test.xml"), []byte(changelog), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "liquibase", "--defaults-file=/dev/null", "--search-path="+dir+","+root, "--changelog-file=test.xml", "--url=jdbc:postgresql://"+net.JoinHostPort(config.ConnConfig.Host, strconv.Itoa(int(config.ConnConfig.Port)))+"/whiteboard_migration_test", "--username="+config.ConnConfig.User, "update", "-Dapp_user="+pgx.Identifier{config.ConnConfig.User}.Sanitize())
	cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+config.ConnConfig.Password)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Liquibase: %v\n%s", err, out)
	}
	runtime, _ := filepath.Abs("../whiteboard-runtime")
	t.Setenv("WHITEBOARD_YJS_RUNTIME_DIR", runtime)
	space, actor, account, plan := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	sql(`INSERT INTO core.space(id,account_id) VALUES($1,$2)`, space, account)
	sql(`INSERT INTO billing.account_subscription VALUES($1,$2,$3,'active',now(),NULL,now())`, uuid.New(), account, plan)
	sql(`INSERT INTO billing.plan_limit VALUES($1,'storage.bytes.total',10000000)`, plan)
	sql(`INSERT INTO billing.space_usage VALUES($1,1000,0,now())`, space)
	t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
	t.Setenv("QUOTA_STORAGE_BLOCKING_ENABLED", "true")
	t.Setenv("QUOTA_MONITOR_ONLY", "false")
	filesystem, err := storage.NewFilesystemStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &assetServiceTestStore{Store: filesystem}
	fixture := func(page int64, asset bool, identity bool) []byte {
		t.Helper()
		script := `import * as Y from 'yjs'; const d=new Y.Doc(); d.getMap('glideboard-records').set('shape:1',{id:'shape:1',kind:'shape',type:'box',x:0,y:0,props:{w:100,h:50}});`
		if asset {
			data := assetServicePNG(t, byte(page))
			hash := fmt.Sprintf("%x", sha256.Sum256(data))
			script += fmt.Sprintf(`d.getMap('glideboard-records').set('asset:sha256:%s',{id:'asset:sha256:%s',kind:'asset',type:'raster-image',schemaVersion:1,props:{hash:'%s',mimeType:'image/png',byteLength:%d,width:3,height:2}});`, hash, hash, hash, len(data))
		}
		if identity {
			script += fmt.Sprintf(`d.getMap('glideboard-meta').set('boardIdentity',%q);`, fmt.Sprintf("v2:%s:%d", space, page))
		}
		script += `process.stdout.write(Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64'));`
		cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script)
		cmd.Dir = runtime
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		bytes, err := base64.StdEncoding.DecodeString(string(out))
		if err != nil {
			t.Fatal(err)
		}
		return bytes
	}
	service := &whiteboardServiceV2{begin: func(ctx context.Context) (pgx.Tx, error) { return pool.Begin(ctx) }, migrationStore: func(context.Context) (storage.Store, error) { return store, nil }}
	seed := func(page int64, asset bool, draft bool) whiteboardMigrationInput {
		t.Helper()
		sql(`INSERT INTO core.page VALUES($1,$2,$3,'2020-01-01',-1,'whiteboard')`, page, space, actor)
		flag := 0
		if draft {
			flag = 1
		}
		sql(`INSERT INTO core.page_doc_map VALUES($1,$2,'Board',$3,now())`, page*10, page, flag)
		state := fixture(page, asset, false)
		sql(`INSERT INTO core.whiteboard_data(doc_id,data) VALUES($1,$2)`, page*10, state)
		tx, _ := pool.Begin(ctx)
		source, err := readMigrationSource(ctx, tx, whiteboardDraftInput{PageID: page, SpaceID: space, ActorID: actor})
		tx.Rollback(ctx)
		if err != nil {
			t.Fatal(err)
		}
		body := whiteboardMigrationBody{SourceDocID: source.SourceDocID, SourceFingerprint: source.Fingerprint, State: fixture(page, false, true), Title: "Board", UpdateEncoding: whiteboardUpdateEncodingV1}
		body.Preview.ContentType = "image/png"
		body.Preview.Data = previewPNG(t, 100)
		return whiteboardMigrationInput{whiteboardDraftInput: whiteboardDraftInput{PageID: page, SpaceID: space, ActorID: actor}, whiteboardMigrationBody: body, IdempotencyKey: uuid.New()}
	}
	count := func(page int64, expected int) {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard WHERE page_id=$1`, page).Scan(&n); err != nil || n != expected {
			t.Fatalf("boards: %d %v", n, err)
		}
	}

	t.Run("draft first, atomic publication and exact retries", func(t *testing.T) {
		in := seed(1, false, true)
		sql(`INSERT INTO core.page_doc_map VALUES(11,1,'Older publication',0,now()+interval '1 day')`)
		source, err := service.GetMigrationSource(ctx, in.whiteboardDraftInput)
		if err != nil || source.SourceDocID != 10 {
			t.Fatalf("draft selection: %+v %v", source, err)
		}
		out, err := service.MigrateWhiteboard(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		retry, err := service.MigrateWhiteboard(ctx, in)
		if err != nil || retry != out {
			t.Fatalf("retry: %+v %v", retry, err)
		}
		changed := in
		changed.Title = "Different"
		if _, err = service.MigrateWhiteboard(ctx, changed); !errors.Is(err, errWhiteboardV2KeyReuse) {
			t.Fatalf("key reuse: %v", err)
		}
		var title string
		var state []byte
		var head, version int64
		var n int
		err = pool.QueryRow(ctx, `SELECT s.title,s.state_bytes,d.head_sequence,v.version_number FROM whiteboard.whiteboard w JOIN whiteboard.whiteboard_draft d USING(page_id) JOIN whiteboard.whiteboard_snapshot s ON s.id=d.base_snapshot_id JOIN whiteboard.whiteboard_version v ON v.id=w.published_version_id WHERE w.page_id=1`).Scan(&title, &state, &head, &version)
		if err != nil || title != "Board" || string(state) != string(in.State) || head != 0 || version != 1 {
			t.Fatalf("target: %v", err)
		}
		pool.QueryRow(ctx, `SELECT count(*) FROM core.page_doc_map WHERE page_id=1`).Scan(&n)
		if n != 2 {
			t.Fatal("legacy records changed")
		}
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_version_preview WHERE version_id=$1`, out.VersionID).Scan(&n)
		if n != 1 {
			t.Fatal("missing preview")
		}
		tx, _ := pool.Begin(ctx)
		err = lockLegacyWhiteboardPage(ctx, tx, 1)
		tx.Rollback(ctx)
		if !errors.Is(err, errWhiteboardMigrated) {
			t.Fatalf("stale writer: %v", err)
		}
		source, err = service.GetMigrationSource(ctx, in.whiteboardDraftInput)
		if err != nil || source.ContentAPIVersion != 2 {
			t.Fatal("v2 discovery failed")
		}
	})
	t.Run("publication fallback and blank source", func(t *testing.T) {
		in := seed(2, false, false)
		sql(`DELETE FROM core.whiteboard_data WHERE doc_id=20`)
		source, err := service.GetMigrationSource(ctx, in.whiteboardDraftInput)
		if err != nil || string(source.State) != string([]byte{0, 0}) {
			t.Fatalf("empty fallback: %v", err)
		}
		in.SourceFingerprint = source.Fingerprint
		if _, err = service.MigrateWhiteboard(ctx, in); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("legacy default page type remains discoverable and preserves history", func(t *testing.T) {
		in := seed(9, false, true)
		sql(`UPDATE core.page SET type='document' WHERE id=9`)
		var id int64
		var kind string
		var foundSpace uuid.UUID
		var apiVersion int
		var published *uuid.UUID
		var preview bool
		if err := pool.QueryRow(ctx, getPageMetadata, int64(9), space, true).Scan(&id, &kind, &foundSpace, &apiVersion, &published, &preview); err != nil || kind != "whiteboard" || apiVersion != 1 {
			t.Fatalf("legacy discovery: %s %d %v", kind, apiVersion, err)
		}
		if _, err := service.MigrateWhiteboard(ctx, in); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `SELECT type FROM core.page WHERE id=9`).Scan(&kind); err != nil || kind != "whiteboard" {
			t.Fatal("migrated legacy history must be excluded from document cleanup")
		}
	})
	t.Run("assets cannot be stripped by client", func(t *testing.T) {
		in := seed(3, true, true)
		if _, err := service.GetMigrationSource(ctx, in.whiteboardDraftInput); err != nil {
			t.Fatalf("source assets: %v", err)
		}
		if _, err := service.MigrateWhiteboard(ctx, in); !errors.Is(err, errWhiteboardMigrationAssetMismatch) {
			t.Fatalf("stripped assets: %v", err)
		}
		count(3, 0)
		clean := seed(4, false, true)
		clean.State = fixture(4, true, true)
		if _, err := service.MigrateWhiteboard(ctx, clean); !errors.Is(err, errWhiteboardMigrationAssetMismatch) {
			t.Fatalf("submitted assets: %v", err)
		}
		count(4, 0)
	})
	t.Run("concurrent migration produces one publication", func(t *testing.T) {
		in := seed(5, false, true)
		var wg sync.WaitGroup
		results := make(chan whiteboardMigrationResult, 2)
		errs := make(chan error, 2)
		for range 2 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				request := in
				request.IdempotencyKey = uuid.New()
				result, err := service.MigrateWhiteboard(ctx, request)
				results <- result
				errs <- err
			}()
		}
		wg.Wait()
		a, b := <-results, <-results
		if a != b {
			t.Fatalf("duplicate results: %+v %+v", a, b)
		}
		for range 2 {
			if err := <-errs; err != nil {
				t.Fatal(err)
			}
		}
		var n int
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_version WHERE page_id=5`).Scan(&n)
		if n != 1 {
			t.Fatal("duplicate publication")
		}
	})
	t.Run("legacy write during preparation invalidates source", func(t *testing.T) {
		in := seed(6, false, true)
		writer, _ := pool.Begin(ctx)
		defer writer.Rollback(ctx)
		if err := lockLegacyWhiteboardPage(ctx, writer, 6); err != nil {
			t.Fatal(err)
		}
		inspected := make(chan struct{})
		proceed := make(chan struct{})
		racer := *service
		racer.inspectMigration = func(ctx context.Context, state []byte, identity string) (whiteboardMigrationInspection, error) {
			result, err := inspectWhiteboardMigration(ctx, state, identity)
			if identity == "" {
				close(inspected)
				<-proceed
			}
			return result, err
		}
		done := make(chan error, 1)
		go func() { _, err := racer.MigrateWhiteboard(ctx, in); done <- err }()
		select {
		case <-inspected:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		if _, err := writer.Exec(ctx, `UPDATE core.page_doc_map SET title='Changed' WHERE doc_id=60`); err != nil {
			t.Fatal(err)
		}
		if err := writer.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		close(proceed)
		if err := <-done; !errors.Is(err, errWhiteboardMigrationSource) {
			t.Fatalf("race: %v", err)
		}
		count(6, 0)
	})
	t.Run("publication failure rolls back all v2 rows", func(t *testing.T) {
		in := seed(7, false, true)
		broken := *service
		broken.begin = func(ctx context.Context) (pgx.Tx, error) {
			tx, err := pool.Begin(ctx)
			return &migrationFailTx{Tx: tx}, err
		}
		if _, err := broken.MigrateWhiteboard(ctx, in); err == nil {
			t.Fatal("expected failure")
		}
		count(7, 0)
		if _, err := service.MigrateWhiteboard(ctx, in); err != nil {
			t.Fatalf("repair retry: %v", err)
		}
	})
	seedRaster := func(page int64) (whiteboardMigrationInput, []byte, string) {
		t.Helper()
		in := seed(page, true, true)
		in.State = fixture(page, true, true)
		data := assetServicePNG(t, byte(page))
		hash := fmt.Sprintf("%x", sha256.Sum256(data))
		key := fmt.Sprintf("whiteboard-assets/%d/%s", page, hash)
		if err := filesystem.Put(ctx, key, bytes.NewReader(data), int64(len(data)), "image/png"); err != nil {
			t.Fatal(err)
		}
		sql(`INSERT INTO core.whiteboard_asset(page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,inspector_version) VALUES($1,$2,$3,$4,'image/png',3,2,$5,1)`, page, hash, key, len(data), actor.String())
		sql(`UPDATE billing.space_usage SET storage_bytes_used=storage_bytes_used+$2 WHERE space_id=$1`, space, len(data))
		return in, data, key
	}
	usage := func() int64 {
		t.Helper()
		var used, reserved int64
		if err := pool.QueryRow(ctx, `SELECT storage_bytes_used,storage_bytes_reserved FROM billing.space_usage WHERE space_id=$1`, space).Scan(&used, &reserved); err != nil {
			t.Fatal(err)
		}
		if reserved != 0 {
			t.Fatalf("leaked quota reservation: %d", reserved)
		}
		return used
	}
	cleanupCopies := func(page int64) {
		t.Helper()
		sql(`UPDATE whiteboard.whiteboard_asset_cleanup SET not_before=now()-interval '1 second',lease_id=NULL,lease_until=NULL WHERE page_id=$1`, page)
		worker := whiteboardAssetServiceV2{begin: pool.Begin, store: func(context.Context) (storage.Store, error) { return filesystem, nil }}
		if _, err := worker.cleanupAssetPass(ctx, 100, 8); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("copies verified raster originals and atomically associates publication", func(t *testing.T) {
		in, data, legacyKey := seedRaster(10)
		before := usage()
		puts := 0
		store.beforePut = func(context.Context, string) error { puts++; return nil }
		defer func() { store.beforePut = nil }()
		out, err := service.MigrateWhiteboard(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		if usage() != before+int64(len(data)) {
			t.Fatal("independent retained copy must be charged once")
		}
		var copyKey string
		var associations, manifests, legacy int
		if err = pool.QueryRow(ctx, `SELECT storage_key FROM whiteboard.whiteboard_asset WHERE page_id=10`).Scan(&copyKey); err != nil || copyKey == legacyKey {
			t.Fatalf("independent key: %s %v", copyKey, err)
		}
		reader, _, err := filesystem.Get(ctx, copyKey)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(reader)
		reader.Close()
		if !bytes.Equal(got, data) {
			t.Fatal("copied bytes changed")
		}
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_snapshot_asset WHERE snapshot_id=$1`, out.SnapshotID).Scan(&associations)
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_snapshot_asset_manifest WHERE snapshot_id=$1 AND state_digest=$2`, out.SnapshotID, migrationDigest(in.State)).Scan(&manifests)
		pool.QueryRow(ctx, `SELECT count(*) FROM core.whiteboard_asset WHERE page_id=10`).Scan(&legacy)
		if associations != 1 || manifests != 1 || legacy != 1 {
			t.Fatalf("manifest/legacy: %d %d %d", associations, manifests, legacy)
		}
		retry, err := service.MigrateWhiteboard(ctx, in)
		if err != nil || retry != out || puts != 1 || usage() != before+int64(len(data)) {
			t.Fatalf("receipt replay: %v %d", err, puts)
		}
		assetService := whiteboardAssetServiceV2{begin: pool.Begin, store: func(context.Context) (storage.Store, error) { return filesystem, nil }}
		stream, err := assetService.OpenAsset(ctx, in.whiteboardDraftInput, fmt.Sprintf("%x", sha256.Sum256(data)), &out.VersionID)
		if err != nil {
			t.Fatal(err)
		}
		published, _ := io.ReadAll(stream.Content)
		stream.Content.Close()
		if !bytes.Equal(published, data) {
			t.Fatal("published asset read failed")
		}
		if exists, _ := filesystem.Exists(ctx, legacyKey); !exists {
			t.Fatal("legacy original removed")
		}
		// The production legacy rollback uses a singleton pool. Run it in a
		// subprocess configured only for this disposable database to avoid leaking
		// that pool into unrelated editor integration tests in this process.
		probe := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMigrationLegacyRollbackRetentionProbe$", "-test.v")
		probe.Env = append(os.Environ(), "PG_HOST="+config.ConnConfig.Host, "PG_PORT="+strconv.Itoa(int(config.ConnConfig.Port)), "PG_USER="+config.ConnConfig.User, "PG_PASSWORD="+config.ConnConfig.Password, "PG_DB=whiteboard_migration_test",
			"WHITEBOARD_MIGRATION_RETAINED_ASSET="+fmt.Sprintf("%x", sha256.Sum256(data)), "WHITEBOARD_MIGRATION_RETAINED_ACTOR="+actor.String())
		if output, probeErr := probe.CombinedOutput(); probeErr != nil {
			t.Fatalf("legacy rollback probe: %v\n%s", probeErr, output)
		}
		if exists, _ := filesystem.Exists(ctx, legacyKey); !exists {
			t.Fatal("late legacy rollback deleted original")
		}
	})
	t.Run("over quota rejects before copying", func(t *testing.T) {
		in, _, _ := seedRaster(11)
		before := usage()
		sql(`UPDATE billing.plan_limit SET limit_value=$1 WHERE plan_id=$2`, before, plan)
		defer sql(`UPDATE billing.plan_limit SET limit_value=10000000 WHERE plan_id=$1`, plan)
		if _, err := service.MigrateWhiteboard(ctx, in); !errors.Is(err, quota.ErrAccountStorageLimitExceeded) {
			t.Fatalf("quota: %v", err)
		}
		count(11, 0)
		if usage() != before {
			t.Fatal("quota changed")
		}
		var jobs int
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_asset_cleanup WHERE page_id=11`).Scan(&jobs)
		if jobs != 0 {
			t.Fatal("copy attempted over quota")
		}
	})
	t.Run("missing or corrupt same-page original leaves v1 intact", func(t *testing.T) {
		in, data, key := seedRaster(12)
		sql(`UPDATE core.whiteboard_asset SET page_id=10 WHERE page_id=12`)
		if _, err := service.MigrateWhiteboard(ctx, in); !errors.Is(err, errWhiteboardAssetNotFound) {
			t.Fatalf("cross-page source: %v", err)
		}
		sql(`UPDATE core.whiteboard_asset SET page_id=12 WHERE storage_key=$1`, key)
		damaged := append([]byte(nil), data...)
		damaged[len(damaged)/2] ^= 0xff
		filesystem.Put(ctx, key, bytes.NewReader(damaged), int64(len(damaged)), "image/png")
		if _, err := service.MigrateWhiteboard(ctx, in); err == nil {
			t.Fatal("corrupt original accepted")
		}
		count(12, 0)
		var legacy int
		pool.QueryRow(ctx, `SELECT count(*) FROM core.page_doc_map WHERE page_id=12`).Scan(&legacy)
		if legacy != 1 {
			t.Fatal("legacy history changed on failure")
		}
		cleanupCopies(12)
		if exists, _ := filesystem.Exists(ctx, key); !exists {
			t.Fatal("cleanup deleted v1 original")
		}
	})
	t.Run("failed copy and failed publication retain durable orphan cleanup", func(t *testing.T) {
		in, _, legacyKey := seedRaster(13)
		before := usage()
		store.afterPutErr = errors.New("injected copy failure after write")
		_, err := service.MigrateWhiteboard(ctx, in)
		store.afterPutErr = nil
		if !errors.Is(err, errWhiteboardAssetUnavailable) {
			t.Fatalf("copy failure: %v", err)
		}
		count(13, 0)
		if usage() != before {
			t.Fatal("failed copy charged quota")
		}
		var key string
		if err = pool.QueryRow(ctx, `SELECT storage_key FROM whiteboard.whiteboard_asset_cleanup WHERE page_id=13`).Scan(&key); err != nil {
			t.Fatal(err)
		}
		if exists, _ := filesystem.Exists(ctx, key); !exists {
			t.Fatal("fixture did not leave an orphan")
		}
		cleanupCopies(13)
		if exists, _ := filesystem.Exists(ctx, key); exists {
			t.Fatal("orphan remained")
		}
		broken := *service
		broken.begin = func(ctx context.Context) (pgx.Tx, error) {
			tx, err := pool.Begin(ctx)
			return &migrationFailTx{Tx: tx}, err
		}
		if _, err = broken.MigrateWhiteboard(ctx, in); err == nil {
			t.Fatal("publication failure accepted")
		}
		count(13, 0)
		if usage() != before {
			t.Fatal("failed atomic publication charged quota")
		}
		cleanupCopies(13)
		if exists, _ := filesystem.Exists(ctx, legacyKey); !exists {
			t.Fatal("legacy bytes removed")
		}
		if _, err = service.MigrateWhiteboard(ctx, in); err != nil {
			t.Fatalf("retry after repair: %v", err)
		}
	})
	t.Run("cleanup claim prevents copied key from becoming live", func(t *testing.T) {
		in, _, _ := seedRaster(14)
		before := usage()
		store.beforePut = func(_ context.Context, key string) error {
			sql(`UPDATE whiteboard.whiteboard_asset_cleanup SET attempt_count=1,lease_id=$2,lease_until=now()+interval '1 minute' WHERE storage_key=$1`, key, uuid.New())
			return nil
		}
		_, err := service.MigrateWhiteboard(ctx, in)
		store.beforePut = nil
		if !errors.Is(err, errWhiteboardAssetBusy) {
			t.Fatalf("claimed copy: %v", err)
		}
		count(14, 0)
		if usage() != before {
			t.Fatal("claimed copy charged quota")
		}
		cleanupCopies(14)
	})
	t.Run("concurrent image migrations charge one copy", func(t *testing.T) {
		in, data, _ := seedRaster(15)
		before := usage()
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		results := make(chan whiteboardMigrationResult, 2)
		for range 2 {
			wg.Add(1)
			go func() { defer wg.Done(); out, err := service.MigrateWhiteboard(ctx, in); results <- out; errs <- err }()
		}
		wg.Wait()
		for range 2 {
			if err := <-errs; err != nil {
				t.Fatal(err)
			}
		}
		if a, b := <-results, <-results; a != b {
			t.Fatal("concurrent receipts differ")
		}
		if usage() != before+int64(len(data)) {
			t.Fatal("concurrent migration charged duplicate bytes")
		}
		cleanupCopies(15)
		count(15, 1)
	})

	t.Run("late cancelled copy rearms cleanup after an earlier delete", func(t *testing.T) {
		in, _, legacyKey := seedRaster(16)
		before := usage()
		started, release := make(chan string, 1), make(chan struct{})
		late := migrationAssetTestStore{Store: filesystem, put: func(_ context.Context, key string, body io.Reader, length int64, media string) error {
			started <- key
			<-release
			return filesystem.Put(ctx, key, body, length, media)
		}}
		interrupted := *service
		interrupted.migrationStore = func(context.Context) (storage.Store, error) { return &late, nil }
		requestCtx, requestCancel := context.WithCancel(ctx)
		defer requestCancel()
		done := make(chan error, 1)
		go func() { _, err := interrupted.MigrateWhiteboard(requestCtx, in); done <- err }()
		var key string
		select {
		case key = <-started:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		count(16, 0)
		var jobs int
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1 AND not_before>now()`, key).Scan(&jobs)
		if jobs != 1 {
			t.Fatal("copy key not durable before Put")
		}
		requestCancel()
		cleanupCopies(16)
		var completed bool
		pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, key).Scan(&completed)
		if !completed {
			t.Fatal("fixture did not complete first cleanup")
		}
		close(release)
		if err := <-done; !errors.Is(err, errWhiteboardAssetUnavailable) {
			t.Fatalf("late copy: %v", err)
		}
		pool.QueryRow(ctx, `SELECT completed_at IS NOT NULL FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, key).Scan(&completed)
		if completed {
			t.Fatal("late write did not rearm completed cleanup")
		}
		count(16, 0)
		if usage() != before {
			t.Fatal("cancelled copy charged quota")
		}
		cleanupCopies(16)
		if exists, _ := filesystem.Exists(ctx, key); exists {
			t.Fatal("late orphan remained")
		}
		if exists, _ := filesystem.Exists(ctx, legacyKey); !exists {
			t.Fatal("legacy original removed")
		}
	})
	t.Run("quota is rechecked at cutover after independent copies", func(t *testing.T) {
		in, _, _ := seedRaster(17)
		before := usage()
		store.beforePut = func(context.Context, string) error {
			sql(`UPDATE billing.plan_limit SET limit_value=$1 WHERE plan_id=$2`, before, plan)
			return nil
		}
		_, err := service.MigrateWhiteboard(ctx, in)
		store.beforePut = nil
		sql(`UPDATE billing.plan_limit SET limit_value=10000000 WHERE plan_id=$1`, plan)
		if !errors.Is(err, quota.ErrAccountStorageLimitExceeded) {
			t.Fatalf("cutover quota: %v", err)
		}
		count(17, 0)
		if usage() != before {
			t.Fatal("rejected cutover charged quota")
		}
		cleanupCopies(17)
	})
	t.Run("archive preflight does not copy images", func(t *testing.T) {
		in, _, _ := seedRaster(18)
		sql(`UPDATE core.space SET archived_at=now() WHERE id=$1`, space)
		_, err := service.MigrateWhiteboard(ctx, in)
		sql(`UPDATE core.space SET archived_at=NULL WHERE id=$1`, space)
		if !errors.Is(err, errWhiteboardV2Archived) {
			t.Fatalf("archive: %v", err)
		}
		var jobs int
		pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_asset_cleanup WHERE page_id=18`).Scan(&jobs)
		if jobs != 0 {
			t.Fatal("archived migration wrote copy intents")
		}
		count(18, 0)
	})

	t.Run("membership and archive checks", func(t *testing.T) {
		in := seed(8, false, true)
		wrong := in.whiteboardDraftInput
		wrong.SpaceID = uuid.New()
		if _, err := service.GetMigrationSource(ctx, wrong); !errors.Is(err, errWhiteboardV2BoardNotFound) {
			t.Fatal(err)
		}
		sql(`UPDATE core.space SET archived_at=now() WHERE id=$1`, space)
		if _, err := service.MigrateWhiteboard(ctx, in); !errors.Is(err, errWhiteboardV2Archived) {
			t.Fatal(err)
		}
		count(8, 0)
		sql(`UPDATE core.space SET archived_at=NULL,deleted_at=now() WHERE id=$1`, space)
		if _, err := service.GetMigrationSource(ctx, in.whiteboardDraftInput); !errors.Is(err, errWhiteboardV2BoardNotFound) {
			t.Fatal(err)
		}
	})
}

type migrationFailTx struct{ pgx.Tx }

func (tx *migrationFailTx) Exec(ctx context.Context, q string, args ...any) (pgconn.CommandTag, error) {
	if q == whiteboardV2PublishVersion {
		return pgconn.CommandTag{}, errors.New("injected publication failure")
	}
	return tx.Tx.Exec(ctx, q, args...)
}

// Ensure request hashing is based on payload, not transient transaction state.
func TestMigrationBodyEncoding(t *testing.T) {
	body := whiteboardMigrationBody{SourceDocID: 9007199254740992}
	encoded, _ := json.Marshal(body)
	var decoded whiteboardMigrationBody
	if err := json.Unmarshal(encoded, &decoded); err != nil || decoded.SourceDocID != body.SourceDocID {
		t.Fatal("source IDs must round-trip as strings")
	}
}

// Models a remote store that completes an in-flight Put despite cancellation.
type migrationAssetTestStore struct {
	storage.Store
	put func(context.Context, string, io.Reader, int64, string) error
}

func (s *migrationAssetTestStore) Put(ctx context.Context, key string, body io.Reader, length int64, media string) error {
	return s.put(ctx, key, body, length, media)
}

func TestMigrationLegacyRollbackRetentionProbe(t *testing.T) {
	hash := os.Getenv("WHITEBOARD_MIGRATION_RETAINED_ASSET")
	if hash == "" {
		t.Skip("isolated retained-original rollback probe")
	}
	if os.Getenv("PG_DB") != "whiteboard_migration_test" {
		t.Fatal("requires disposable migration database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := media.RollbackWhiteboardAsset(ctx, 10, hash, os.Getenv("WHITEBOARD_MIGRATION_RETAINED_ACTOR")); !errors.Is(err, media.ErrWhiteboardAssetReferenced) {
		t.Fatalf("late legacy rollback must retain source: %v", err)
	}
}
