package editor

import (
	"context"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPublishedMentionBaselinePostgres(t *testing.T) {
	dsn := os.Getenv("EDITOR_MENTIONS_TEST_DSN")
	if dsn == "" {
		t.Skip("set EDITOR_MENTIONS_TEST_DSN to a disposable editor_mentions_test database")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnConfig.Database != "editor_mentions_test" {
		t.Fatal("refusing database other than editor_mentions_test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE SCHEMA core;
 CREATE TABLE core.space(id uuid PRIMARY KEY, archived_at timestamptz, deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid REFERENCES core.space);
 CREATE TABLE core.page_doc_map(doc_id bigint PRIMARY KEY,page_id bigint,version timestamptz,draft smallint);
 CREATE TABLE core.content(doc_id bigint,type text,attrs jsonb);`)
	defer exec(`DROP SCHEMA core CASCADE`)
	spaceID, old, added := uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO core.space(id) VALUES($1)`, spaceID)
	exec(`INSERT INTO core.page VALUES(123,$1)`, spaceID)
	exec(`INSERT INTO core.page_doc_map VALUES(1,123,now()-interval '1 day',0),(2,123,now(),1)`)
	exec(`INSERT INTO core.content VALUES(1,'mention',jsonb_build_object('id',$1::text)),(2,'mention',jsonb_build_object('id',$2::text))`, old, added)
	begin := func() pgx.Tx {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return tx
	}
	first := begin()
	defer first.Rollback(ctx)
	ids, err := lockPublishedMentionBaseline(ctx, first, 123, spaceID)
	if err != nil || !reflect.DeepEqual(ids, []string{old.String()}) {
		t.Fatalf("draft affected baseline: %v %v", ids, err)
	}
	// A competing publication must wait rather than read the same stale baseline.
	second := begin()
	blocked, cancelBlocked := context.WithTimeout(ctx, 100*time.Millisecond)
	_, err = lockPublishedMentionBaseline(blocked, second, 123, spaceID)
	cancelBlocked()
	second.Rollback(ctx)
	if err == nil {
		t.Fatal("concurrent publication was not serialized")
	}
	if _, err = first.Exec(ctx, `UPDATE core.page_doc_map SET draft=0 WHERE doc_id=2`); err != nil {
		t.Fatal(err)
	}
	if err = first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	next := begin()
	defer next.Rollback(ctx)
	ids, err = lockPublishedMentionBaseline(ctx, next, 123, spaceID)
	if err != nil || !reflect.DeepEqual(ids, []string{added.String()}) {
		t.Fatalf("new publication missing from baseline: %v %v", ids, err)
	}
	if len(newPublishedMentionIDs(mentionNodes(added.String()), ids, uuid.New())) != 0 {
		t.Fatal("concurrent unchanged publication would notify twice")
	}
	next.Rollback(ctx)
	wrongSpace := begin()
	defer wrongSpace.Rollback(ctx)
	if _, err = lockPublishedMentionBaseline(ctx, wrongSpace, 123, uuid.New()); err == nil {
		t.Fatal("wrong space accepted")
	}
	wrongSpace.Rollback(ctx)
	exec(`UPDATE core.space SET archived_at=now() WHERE id=$1`, spaceID)
	archived := begin()
	defer archived.Rollback(ctx)
	if _, err = lockPublishedMentionBaseline(ctx, archived, 123, spaceID); err == nil {
		t.Fatal("archived space accepted")
	}
	archived.Rollback(ctx)
}
