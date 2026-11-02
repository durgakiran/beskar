package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DocumentNodes creates a minimal document fixture in a rollback-only transaction.
// The dedicated database guard prevents running the DDL against application data.
func DocumentNodes(t *testing.T) (context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("DOCUMENT_NODE_TEST_DSN")
	if dsn == "" {
		t.Skip("set DOCUMENT_NODE_TEST_DSN to disposable beskar_document_nodes_test database")
	}
	ctx := context.Background()
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Database != "beskar_document_nodes_test" {
		t.Fatal("requires disposable beskar_document_nodes_test database")
	}
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	Exec(t, ctx, tx, `CREATE SCHEMA core;
CREATE TABLE core.space(id uuid PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE core.page(id bigint PRIMARY KEY, space_id uuid, type text);
CREATE TABLE core.page_doc_map(doc_id bigint PRIMARY KEY, page_id bigint, title text, owner_id uuid, draft smallint, version timestamptz, draft_generation bigint);
CREATE TABLE core.content(id uuid PRIMARY KEY, doc_id bigint, parent_id uuid, "order" bigint, type text, attrs jsonb, marks jsonb);
CREATE TABLE core.text_node(doc_id bigint, parent_id uuid, "order" bigint, text text, marks jsonb);
CREATE TABLE core.attachment(id uuid PRIMARY KEY, page_id bigint, deleted_at timestamptz);
CREATE TABLE core.image_asset(id uuid PRIMARY KEY, public_name text, page_id bigint, deleted_at timestamptz);
CREATE TABLE core.asset_reference(asset_type text, asset_id text, page_id bigint, doc_id bigint, source_kind text, source_id text, last_seen_at timestamptz, created_at timestamptz, updated_at timestamptz);`)
	spaceID, ownerID, rootID := uuid.New(), uuid.New(), uuid.New()
	Exec(t, ctx, tx, `INSERT INTO core.space VALUES($1,NULL)`, spaceID)
	Exec(t, ctx, tx, `INSERT INTO core.page VALUES(1,$1,'document')`, spaceID)
	Exec(t, ctx, tx, `INSERT INTO core.page_doc_map VALUES(10,1,'Published document',$1,0,now(),0)`, ownerID)
	Exec(t, ctx, tx, `INSERT INTO core.content VALUES($1,10,NULL,0,'paragraph','{}','[]')`, rootID)
	Exec(t, ctx, tx, `INSERT INTO core.content VALUES($1,10,$2,1,'imageBlock','{"src":"/media/image/test-image.png"}','[]')`, uuid.New(), rootID)
	Exec(t, ctx, tx, `INSERT INTO core.text_node VALUES(10,$1,0,'Nested text','[{"type":"bold"}]')`, rootID)
	return ctx, tx, spaceID, ownerID, rootID
}

func Exec(t *testing.T, ctx context.Context, tx pgx.Tx, query string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(ctx, query, args...); err != nil {
		t.Fatal(err)
	}
}
