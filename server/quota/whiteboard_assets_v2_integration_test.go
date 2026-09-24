package quota

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWhiteboardAssetsV2ReconciliationPostgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_ASSET_QUOTA_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_ASSET_QUOTA_TEST_DSN to disposable whiteboard_asset_quota_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_asset_quota_test" {
		t.Fatal("requires disposable whiteboard_asset_quota_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// These are the shared columns read by the reconciliation queries; production
	// asset migrations and their constraints are exercised by editor integration.
	exec(`DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS billing CASCADE;
 CREATE SCHEMA core; CREATE SCHEMA whiteboard; CREATE SCHEMA billing;
 CREATE TABLE core.space(id uuid PRIMARY KEY,account_id uuid NOT NULL,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL);
 CREATE TABLE core.attachment(page_id bigint,file_size bigint,deleted_at timestamptz);
 CREATE TABLE core.image_asset(page_id bigint,file_size bigint,deleted_at timestamptz);
 CREATE TABLE core.whiteboard_asset(page_id bigint,file_size bigint);
 CREATE TABLE whiteboard.whiteboard_asset(page_id bigint,content_hash text,file_size bigint,PRIMARY KEY(page_id,content_hash));
 CREATE TABLE whiteboard.whiteboard_asset_upload(page_id bigint,byte_length bigint);
 CREATE TABLE billing.space_usage(space_id uuid PRIMARY KEY,storage_bytes_used bigint NOT NULL,storage_bytes_reserved bigint NOT NULL,updated_at timestamptz);
 CREATE TABLE billing.space_usage_event(space_id uuid,metric_key text,event_type text,delta_value bigint,source_type text,source_id text,correlation_id text,metadata jsonb,created_at timestamptz);`)
	account, otherAccount := uuid.New(), uuid.New()
	space, sibling, deleted, foreign := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO core.space VALUES($1,$5,NULL),($2,$5,NULL),($3,$5,now()),($4,$6,NULL)`, space, sibling, deleted, foreign, account, otherAccount)
	exec(`INSERT INTO core.page VALUES(1,$1),(2,$1),(3,$2),(4,$3),(5,$4)`, space, sibling, deleted, foreign)
	exec(`INSERT INTO core.attachment VALUES(1,11,NULL),(1,999,now());
 INSERT INTO core.image_asset VALUES(1,13,NULL),(1,999,now());
 INSERT INTO core.whiteboard_asset VALUES(1,17);
 INSERT INTO whiteboard.whiteboard_asset VALUES(1,'same-hash',101),(1,'second-hash',103),(2,'same-hash',101),(3,'same-hash',101),(4,'same-hash',101),(5,'same-hash',101);
 INSERT INTO whiteboard.whiteboard_asset_upload VALUES(1,10000);`)
	assertTotal := func(query string, argument any, expected int64) {
		t.Helper()
		var got int64
		if err := pool.QueryRow(ctx, query, argument).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != expected {
			t.Fatalf("storage total = %d; expected %d", got, expected)
		}
	}
	// Same-board hashes have one catalog row. The same bytes on another board
	// are separately owned; staged sessions and soft-deleted legacy rows add none.
	assertTotal(getPageStorageBytesQuery, int64(1), 245)
	assertTotal(getSpaceReconciledStorageQuery, space, 346)
	assertTotal(getAccountReconciledStorageQuery, account, 447)
	assertTotal(getAccountReconciledStorageQuery, otherAccount, 101)
	exec(`INSERT INTO billing.space_usage VALUES($1,346,7,now())`, space)
	t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := ReleasePageStorageUsageTx(ctx, tx, space, 1, "page_delete"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var used, reserved, released int64
	if err := pool.QueryRow(ctx, `SELECT storage_bytes_used,storage_bytes_reserved FROM billing.space_usage WHERE space_id=$1`, space).Scan(&used, &reserved); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT delta_value FROM billing.space_usage_event WHERE space_id=$1`, space).Scan(&released); err != nil {
		t.Fatal(err)
	}
	if used != 101 || reserved != 7 || released != -245 {
		t.Fatalf("page release: used=%d reserved=%d delta=%d", used, reserved, released)
	}
}
