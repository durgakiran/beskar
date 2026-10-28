package search

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Explicit opt-in: creates and drops a unique database on disposable PostgreSQL
// with pg_search preloaded. Never points at an application's database directly.
func TestRepositoryIntegration(t *testing.T) {
	dsn := os.Getenv("SEARCH_API_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SEARCH_API_TEST_DATABASE_URL to a disposable PostgreSQL server")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "search_api_test_" + uuid.New().String()[:8]
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	}()
	cfg := admin.Config()
	cfg.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE EXTENSION vector; CREATE EXTENSION pg_search CASCADE;
 CREATE SCHEMA core;
 CREATE TABLE core.space(id uuid PRIMARY KEY,name text,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid,type text);
 CREATE TABLE core.page_doc_map(page_id bigint,doc_id bigint,title text,version timestamptz,draft int);
 CREATE TABLE public.documents(page_id bigint PRIMARY KEY,space_id uuid,created_by uuid,doc_id bigint,title text,body_text text,created_at timestamptz,updated_at timestamptz);
 CREATE INDEX documents_search_idx ON public.documents USING paradedb(page_id,space_id,created_by,doc_id,title,body_text,created_at,updated_at);
 INSERT INTO core.space VALUES('11111111-1111-1111-1111-111111111111','Product',NULL,NULL),('22222222-2222-2222-2222-222222222222','Archived',now(),NULL);
 INSERT INTO core.page SELECT id,'11111111-1111-1111-1111-111111111111','document' FROM generate_series(1,4) id;
 INSERT INTO core.page VALUES(5,'22222222-2222-2222-2222-222222222222','document'),(6,'11111111-1111-1111-1111-111111111111','document'),(7,'11111111-1111-1111-1111-111111111111','document');
 INSERT INTO core.page_doc_map SELECT id,id+100,CASE WHEN id=1 THEN 'Roadmap' WHEN id=7 THEN 'Browser preferences' ELSE 'Plans' END,'2026-10-28'::timestamptz,0 FROM generate_series(1,7) id;
 INSERT INTO public.documents SELECT p.id,p.space_id,'33333333-3333-3333-3333-333333333333',d.doc_id,d.title,CASE WHEN p.id=1 THEN 'Milestones for the year' WHEN p.id=6 THEN 'An unrelated note about version 3.0 and string type annotations' WHEN p.id=7 THEN 'return localStorage.getItem(RECENTS_KEY);' ELSE 'roadmap for the team' END,'2026-10-01',d.version FROM core.page p JOIN core.page_doc_map d ON d.page_id=p.id;
 UPDATE core.page_doc_map SET doc_id=999 WHERE page_id=4;`)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, pool)
	denied := map[int64]bool{3: true}
	service.canView = func(_ context.Context, id int64, _ uuid.UUID) (bool, error) { return !denied[id], nil }
	actor := uuid.New()
	for _, query := range []string{"roadmap", "road"} {
		results, err := service.Search(ctx, actor, query, 8)
		if err != nil {
			t.Fatalf("query %q: %v", query, err)
		}
		if len(results) == 0 || results[0].PageID != 1 {
			t.Fatalf("query %q did not find weighted/prefix title match: %+v", query, results)
		}
		for _, r := range results {
			if r.PageID >= 3 {
				t.Fatal("unrelated, denied, or stale/archived publication returned")
			}
		}
	}
	// Reuse the same prepared statement for different keywords. If $1 is
	// inferred as pdb.boost, its later ::text becomes serialized query JSON,
	// and constant tokens such as the internal "string" key spuriously match page 6.
	for _, query := range []string{"zzzxqvnomatch92741", "pasta", "keyboard", "zzzxqvnomatch92741"} {
		results, err := service.Search(ctx, actor, query, 8)
		if err != nil || len(results) != 0 {
			t.Fatalf("unrelated query %q returned %v (err=%v)", query, results, err)
		}
	}
	resultsForVersion, err := service.Search(ctx, actor, "version", 8)
	if err != nil || len(resultsForVersion) != 1 || resultsForVersion[0].PageID != 6 {
		t.Fatal("a distinct keyword did not find only its actual matching publication")
	}

	// Code identifiers can remain a single indexed token. Prefix matching must
	// work in bodies as well as titles, without matching arbitrary substrings.
	for _, query := range []string{"localstorage", "localstor", "LOCALSTORAGE", "localStorage.getItem"} {
		results, err := service.Search(ctx, actor, query, 8)
		if err != nil || len(results) != 1 || results[0].PageID != 7 {
			t.Fatalf("body identifier query %q returned %v (err=%v)", query, results, err)
		}
	}
	resultsForSubstring, err := service.Search(ctx, actor, "storage", 8)
	if err != nil || len(resultsForSubstring) != 0 {
		t.Fatal("prefix search broadened into arbitrary substring matching")
	}
	denied[7] = true
	resultsForDeniedBody, err := service.Search(ctx, actor, "localstorage", 8)
	if err != nil || len(resultsForDeniedBody) != 0 {
		t.Fatal("body prefix bypassed page permissions")
	}

	denied[1] = true
	denied[2] = true
	results, err := service.Search(ctx, actor, "roadmap", 8)
	if err != nil || len(results) != 0 {
		t.Fatal("permission revocation did not hide indexed documents")
	}
	if _, err := service.Search(ctx, actor, "title:secret* OR '1'='1'", 8); err != nil {
		t.Fatal("plain text query was interpreted as SQL/DSL")
	}
}
