package editor

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestViewMetaPostgres(t *testing.T) {
	dsn := os.Getenv("VIEW_METADATA_TEST_DSN")
	if dsn == "" {
		t.Skip("set VIEW_METADATA_TEST_DSN to disposable beskar_view_metadata_test database")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if conn.Config().Database != "beskar_view_metadata_test" {
		t.Fatal("requires disposable beskar_view_metadata_test database")
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE SCHEMA core; CREATE SCHEMA whiteboard;
 CREATE TABLE core.page(id bigint PRIMARY KEY, owner_id uuid,date_created timestamptz);
 CREATE TABLE core.page_doc_map(doc_id bigint PRIMARY KEY,page_id bigint,owner_id uuid,version timestamptz,draft smallint,title text,draft_generation bigint DEFAULT 0);
 CREATE TABLE core.user_id_map(user_id uuid,zita_id text);
 CREATE TABLE whiteboard.whiteboard(page_id bigint,published_version_id uuid);
 CREATE TABLE whiteboard.whiteboard_version(id uuid,page_id bigint,published_at timestamptz,published_by uuid);`)
	creator, editor, draftEditor, version := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	published := time.Date(2026, 10, 18, 10, 0, 0, 0, time.UTC)
	exec(`INSERT INTO core.user_id_map VALUES($1,'creator'),($2,'editor'),($3,'draft-editor')`, creator, editor, draftEditor)
	exec(`INSERT INTO core.page VALUES(1,$1,$2),(2,$1,$2),(3,$1,$2)`, creator, published.Add(-24*time.Hour))
	exec(`INSERT INTO core.page_doc_map(doc_id,page_id,owner_id,version,draft) VALUES(10,1,$1,$3,0),(11,1,$2,$4,1)`, editor, draftEditor, published, published.Add(time.Hour))
	exec(`INSERT INTO whiteboard.whiteboard VALUES(2,$1),(3,NULL)`, version)
	exec(`INSERT INTO whiteboard.whiteboard_version VALUES($1,2,$2,$3)`, version, published, editor)
	for _, id := range []int64{1, 2, 3} {
		meta, err := fetchViewMeta(tx, ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if meta.createdByID != "creator" {
			t.Fatalf("page %d creator: %+v", id, meta)
		}
		if meta.CreatedAt == nil || !meta.CreatedAt.Equal(published.Add(-24*time.Hour)) {
			t.Fatalf("page %d creation time: %+v", id, meta)
		}
		if id == 3 {
			if meta.UpdatedAt != nil || meta.updatedByID != "" {
				t.Fatalf("unpublished page has update metadata: %+v", meta)
			}
		} else if meta.updatedByID != "editor" || meta.UpdatedAt == nil || !meta.UpdatedAt.Equal(published) {
			t.Fatalf("page %d should describe the publication, not the newer draft: %+v", id, meta)
		}
	}
	// A different publisher must become the recorded editor of the version.
	var generation int64
	if err := tx.QueryRow(ctx, updateDocQuery, "New title", published.Add(2*time.Hour), int64(11), int64(1), 0, editor).Scan(&generation); err != nil {
		t.Fatal(err)
	}
	meta, err := fetchViewMeta(tx, ctx, 1)
	if err != nil || meta.updatedByID != "editor" || meta.UpdatedAt == nil || !meta.UpdatedAt.Equal(published.Add(2*time.Hour)) {
		t.Fatalf("publication did not record the current editor: %+v %v", meta, err)
	}
}
