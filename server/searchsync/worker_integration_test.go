package searchsync

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Explicit opt-in: this test creates and drops two uniquely named databases.
// The DSN must point to a disposable PostgreSQL 16 server with pg_search loaded.
func TestWorkerIntegration(t *testing.T) {
	dsn := os.Getenv("SEARCH_SYNC_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SEARCH_SYNC_TEST_DATABASE_URL to a disposable PostgreSQL server")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	must(t, err)
	t.Cleanup(admin.Close)
	suffix := uuid.New().String()[:8]
	pools := make([]*pgxpool.Pool, 0, 2)
	for _, name := range []string{"sync_source_" + suffix, "sync_target_" + suffix} {
		_, err = admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize())
		must(t, err)
		name := name
		t.Cleanup(func() {
			cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
			defer stop()
			_, err := admin.Exec(cleanup, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
			if err != nil {
				t.Errorf("cleanup %s: %v", name, err)
			}
		})
		cfg, err := pgxpool.ParseConfig(dsn)
		must(t, err)
		cfg.ConnConfig.Database = name
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		must(t, err)
		pools = append(pools, pool)
	}
	source, target := pools[0], pools[1]
	t.Cleanup(source.Close)
	t.Cleanup(target.Close)
	execSQL(t, ctx, source, `CREATE SCHEMA core;
 CREATE TABLE core.space(id uuid PRIMARY KEY,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL REFERENCES core.space,owner_id uuid NOT NULL,date_created timestamptz NOT NULL,type text NOT NULL);
 CREATE TABLE core.page_doc_map(doc_id bigint PRIMARY KEY,page_id bigint REFERENCES core.page ON DELETE CASCADE,title text,version timestamptz,draft int);
 CREATE TABLE core.content(id uuid,doc_id bigint REFERENCES core.page_doc_map ON DELETE CASCADE,parent_id uuid,"order" bigint,type text,attrs jsonb,PRIMARY KEY(id,doc_id));
 CREATE TABLE core.text_node(doc_id bigint REFERENCES core.page_doc_map ON DELETE CASCADE,parent_id uuid,"order" bigint,text text);`)
	// Exercise the changelog's actual runtime grants under non-owner roles.
	sourceRole, targetRole := "sync_source_writer_"+suffix, "sync_target_writer_"+suffix
	for _, role := range []string{sourceRole, targetRole} {
		_, err := admin.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role}.Sanitize())
		must(t, err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		for i, role := range []string{sourceRole, targetRole} {
			_, err := pools[i].Exec(cleanup, "DROP OWNED BY "+pgx.Identifier{role}.Sanitize())
			if err != nil {
				t.Error(err)
			}
			_, err = admin.Exec(cleanup, "DROP ROLE "+pgx.Identifier{role}.Sanitize())
			if err != nil {
				t.Error(err)
			}
		}
	})
	runtimePools := make([]*pgxpool.Pool, 0, 2)
	for i, file := range []string{"../../db/beskar/updates/search_sync.xml", "../../db/search/update.xml"} {
		role := []string{sourceRole, targetRole}[i]
		applyChangelog(t, ctx, pools[i], file, []string{"app_user", "search_writer"}[i], role)
		if i == 0 {
			execSQL(t, ctx, source, "GRANT USAGE ON SCHEMA core TO "+pgx.Identifier{role}.Sanitize()+"; GRANT SELECT ON ALL TABLES IN SCHEMA core TO "+pgx.Identifier{role}.Sanitize())
		}
		runtimeCfg := pools[i].Config()
		runtimeCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, "SET ROLE "+pgx.Identifier{role}.Sanitize())
			return err
		}
		runtimePool, err := pgxpool.NewWithConfig(ctx, runtimeCfg)
		must(t, err)
		runtimePools = append(runtimePools, runtimePool)
		t.Cleanup(runtimePool.Close)
	}
	cfg := DefaultConfig()
	cfg.WorkerEnabled = true
	targetConfig := target.Config().ConnConfig
	cfg.Database = DatabaseConfig{Host: targetConfig.Host, Port: fmt.Sprint(targetConfig.Port),
		Name: targetConfig.Database, User: targetConfig.User, Password: targetConfig.Password, SSLMode: "disable"}
	cfg.MaxAttempts = 2
	worker, err := NewWorker(runtimePools[0], runtimePools[1], cfg, nil)
	must(t, err)
	t.Setenv("SEARCH_SYNC_CAPTURE_ENABLED", "true")
	spaceID, owner := uuid.New(), uuid.New()
	_, err = source.Exec(ctx, `INSERT INTO core.space(id) VALUES($1)`, spaceID)
	must(t, err)
	queue := func(page int64) {
		t.Helper()
		tx, err := source.Begin(ctx)
		must(t, err)
		must(t, QueuePage(ctx, tx, page, ReasonReconcile))
		must(t, tx.Commit(ctx))
	}
	batch := func() Stats { t.Helper(); stats, err := worker.ProcessBatch(ctx); must(t, err); return stats }
	body := func(wantTitle, wantBody string, wantDoc int64) {
		t.Helper()
		var title, text string
		var doc int64
		var actualSpace, creator uuid.UUID
		var created, updated time.Time
		err := target.QueryRow(ctx, `SELECT title,body_text,doc_id,space_id,created_by,created_at,updated_at FROM public.documents WHERE page_id=1`).Scan(&title, &text, &doc, &actualSpace, &creator, &created, &updated)
		must(t, err)
		if title != wantTitle || text != wantBody || doc != wantDoc || actualSpace != spaceID || creator != owner || created.IsZero() || updated.IsZero() {
			t.Fatalf("unexpected search metadata/body: title=%q body=%q doc=%d", title, text, doc)
		}
	}
	matches := func(term string, want int) {
		t.Helper()
		var count int
		must(t, target.QueryRow(ctx, `SELECT count(*) FROM public.documents WHERE body_text ||| $1`, term).Scan(&count))
		if count != want {
			t.Fatalf("matches(%q)=%d, want %d", term, count, want)
		}
	}
	t.Run("lookup catalog and foreign keys", func(t *testing.T) {
		reasons := map[ReasonID]string{ReasonDocumentCreated: "document_created", ReasonDocumentPublished: "document_published", ReasonDocumentDeleted: "document_deleted", ReasonSpaceArchived: "space_archived", ReasonSpaceUnarchived: "space_unarchived", ReasonSpaceDeleted: "space_deleted", ReasonBackfill: "backfill", ReasonReconcile: "reconcile"}
		for id, want := range reasons {
			var got string
			must(t, runtimePools[0].QueryRow(ctx, `SELECT name FROM search_sync.reasons WHERE id=$1`, id).Scan(&got))
			if got != want {
				t.Fatalf("reason %d: %s != %s", id, got, want)
			}
		}
		for id, want := range map[StatusID]string{StatusPending: "pending", StatusCompleted: "completed", StatusFailed: "failed"} {
			var got string
			must(t, runtimePools[0].QueryRow(ctx, `SELECT name FROM search_sync.statuses WHERE id=$1`, id).Scan(&got))
			if got != want {
				t.Fatalf("status %d: %s != %s", id, got, want)
			}
		}
		for _, sql := range []string{`INSERT INTO search_sync.outbox(page_id,reason_id) VALUES(1,32767)`, `INSERT INTO search_sync.outbox(page_id,reason_id,status_id) VALUES(1,1,32767)`} {
			_, err := runtimePools[0].Exec(ctx, sql)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
				t.Fatalf("expected foreign key violation, got %v", err)
			}
		}
		_, err := runtimePools[0].Exec(ctx, `UPDATE search_sync.statuses SET name='changed' WHERE id=1`)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("lookup catalogs must be read-only for app role: %v", err)
		}
	})
	t.Run("transaction rollback and title-only creation", func(t *testing.T) {
		tx, err := source.Begin(ctx)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.page VALUES(1,$1,$2,now(),'document');`, spaceID, owner)
		must(t, err)
		must(t, QueuePage(ctx, tx, 1, ReasonDocumentCreated))
		must(t, tx.Rollback(ctx))
		if got := batch(); got.Processed != 0 {
			t.Fatal(got)
		}
		tx, err = source.Begin(ctx)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.page VALUES(1,$1,$2,now(),'document')`, spaceID, owner)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.page_doc_map VALUES(10,1,'Title only',now(),0)`)
		must(t, err)
		must(t, QueuePage(ctx, tx, 1, ReasonDocumentCreated))
		must(t, tx.Commit(ctx))
		if got := batch(); got.Upserted != 1 {
			t.Fatal(got)
		}
		body("Title only", "", 10)
	})
	root, paragraph := uuid.New(), uuid.New()
	t.Run("published text and newer private draft", func(t *testing.T) {
		tx, err := source.Begin(ctx)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.page_doc_map VALUES(11,1,'Published',now()+interval '1 second',0),(12,1,'Private draft',now()+interval '1 hour',1)`)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.content VALUES($1,11,NULL,0,'doc',NULL),($2,11,$1,0,'paragraph',NULL)`, root, paragraph)
		must(t, err)
		_, err = tx.Exec(ctx, `INSERT INTO core.text_node VALUES(11,$1,0,'zebra published content'),(12,$1,0,'secret draft')`, paragraph)
		must(t, err)
		must(t, QueuePage(ctx, tx, 1, ReasonDocumentPublished))
		must(t, QueuePage(ctx, tx, 1, ReasonDocumentPublished))
		must(t, tx.Commit(ctx))
		if got := batch(); got.Upserted != 2 {
			t.Fatal(got)
		}
		body("Published", "zebra published content", 11)
		matches("zebra", 1)
		matches("secret", 0)
	})
	t.Run("delayed refresh reads latest state", func(t *testing.T) {
		queue(1)
		_, err := source.Exec(ctx, `UPDATE core.text_node SET text='giraffe updated content' WHERE doc_id=11`)
		must(t, err)
		batch()
		body("Published", "giraffe updated content", 11)
		matches("zebra", 0)
		matches("giraffe", 1)
	})
	t.Run("singleton lock prevents competing writer", func(t *testing.T) {
		queue(1)
		conn, err := target.Acquire(ctx)
		must(t, err)
		_, err = conn.Exec(ctx, `SELECT pg_advisory_lock($1,$2)`, lockNamespace, lockKey)
		must(t, err)
		stats := batch()
		if stats.Leader || stats.Processed != 0 {
			t.Fatal(stats)
		}
		_, err = conn.Exec(ctx, `SELECT pg_advisory_unlock($1,$2)`, lockNamespace, lockKey)
		must(t, err)
		conn.Release()
		batch()
	})
	t.Run("lost target session releases leadership and retries", func(t *testing.T) {
		queue(1)
		blocker, err := source.Begin(ctx)
		must(t, err)
		_, err = blocker.Exec(ctx, `LOCK TABLE core.text_node IN ACCESS EXCLUSIVE MODE`)
		must(t, err)
		defer blocker.Rollback(context.Background())
		done := make(chan error, 1)
		go func() { _, err := worker.ProcessBatch(ctx); done <- err }()
		var pid int
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			err = target.QueryRow(ctx, `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=$1 AND objid=$2 AND granted LIMIT 1`, lockNamespace, lockKey).Scan(&pid)
			if err == nil {
				break
			}
			if err != pgx.ErrNoRows {
				must(t, err)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if pid == 0 {
			t.Fatal("worker did not acquire target lock")
		}
		var killed bool
		must(t, target.QueryRow(ctx, `SELECT pg_terminate_backend($1)`, pid).Scan(&killed))
		if !killed {
			t.Fatal("target session not terminated")
		}
		must(t, blocker.Commit(ctx))
		if err := <-done; err == nil {
			t.Fatal("lost target session accepted")
		}
		execSQL(t, ctx, source, `UPDATE search_sync.outbox SET next_attempt_at=now() WHERE status_id=1`)
		if got := batch(); got.Upserted != 1 {
			t.Fatal(got)
		}
		body("Published", "giraffe updated content", 11)
	})
	t.Run("acknowledgement failure replays committed target", func(t *testing.T) {
		execSQL(t, ctx, source, `CREATE FUNCTION search_sync.reject_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status_id=2 THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_ack BEFORE UPDATE ON search_sync.outbox FOR EACH ROW EXECUTE FUNCTION search_sync.reject_ack();`)
		queue(1)
		if got := batch(); got.Failed != 1 {
			t.Fatal(got)
		}
		body("Published", "giraffe updated content", 11)
		execSQL(t, ctx, source, `DROP TRIGGER reject_ack ON search_sync.outbox;UPDATE search_sync.outbox SET next_attempt_at=now() WHERE status_id=1`)
		if got := batch(); got.Upserted != 1 {
			t.Fatal(got)
		}
	})
	t.Run("malformed tree bounded retries preserve indexed body", func(t *testing.T) {
		_, err := source.Exec(ctx, `UPDATE core.content SET type='unknown-type' WHERE id=$1`, paragraph)
		must(t, err)
		queue(1)
		if got := batch(); got.Failed != 1 {
			t.Fatal(got)
		}
		var attempts int
		var status StatusID
		var code string
		var nextAttempt time.Time
		must(t, source.QueryRow(ctx, `SELECT attempts,status_id,last_error_code,next_attempt_at FROM search_sync.outbox ORDER BY id DESC LIMIT 1`).Scan(&attempts, &status, &code, &nextAttempt))
		if attempts != 1 || status != StatusPending || code != "extraction_unsupported_node" || !nextAttempt.After(time.Now().Add(-time.Second)) {
			t.Fatalf("retry state %d %d %s %s", attempts, status, code, nextAttempt)
		}
		execSQL(t, ctx, source, `UPDATE search_sync.outbox SET next_attempt_at=now() WHERE status_id=1`)
		batch()
		must(t, source.QueryRow(ctx, `SELECT attempts,status_id FROM search_sync.outbox ORDER BY id DESC LIMIT 1`).Scan(&attempts, &status))
		if status != StatusFailed || attempts != 2 {
			t.Fatalf("terminal state %d/%d", status, attempts)
		}
		body("Published", "giraffe updated content", 11)
		_, err = source.Exec(ctx, `UPDATE core.content SET type='paragraph' WHERE id=$1`, paragraph)
		must(t, err)
		execSQL(t, ctx, source, `UPDATE search_sync.outbox SET status_id=1,attempts=0,next_attempt_at=now() WHERE status_id=3`)
		batch()
	})
	t.Run("archive rollback archive and unarchive", func(t *testing.T) {
		tx, err := source.Begin(ctx)
		must(t, err)
		_, err = tx.Exec(ctx, `UPDATE core.space SET archived_at=now()`)
		must(t, err)
		must(t, QueueSpace(ctx, tx, spaceID, ReasonSpaceArchived))
		must(t, tx.Rollback(ctx))
		if got := batch(); got.Processed != 0 {
			t.Fatal(got)
		}
		for _, archived := range []bool{true, false} {
			tx, err := source.Begin(ctx)
			must(t, err)
			_, err = tx.Exec(ctx, `UPDATE core.space SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END`, archived)
			must(t, err)
			reason := ReasonSpaceUnarchived
			if archived {
				reason = ReasonSpaceArchived
			}
			must(t, QueueSpace(ctx, tx, spaceID, reason))
			must(t, tx.Commit(ctx))
			stats := batch()
			if archived && stats.Deleted != 1 {
				t.Fatal(stats)
			}
			if !archived {
				body("Published", "giraffe updated content", 11)
			}
		}
	})
	t.Run("backfill and concurrent workers", func(t *testing.T) {
		tx, err := source.Begin(ctx)
		must(t, err)
		last, count, err := Backfill(ctx, tx, 0, 25)
		must(t, err)
		if last != 1 || count != 1 {
			t.Fatalf("backfill %d %d", last, count)
		}
		must(t, tx.Commit(ctx))
		other, err := NewWorker(runtimePools[0], runtimePools[1], cfg, nil)
		must(t, err)
		done := make(chan error, 2)
		go func() { _, err := worker.ProcessBatch(ctx); done <- err }()
		go func() { _, err := other.ProcessBatch(ctx); done <- err }()
		must(t, <-done)
		must(t, <-done)
		body("Published", "giraffe updated content", 11)
	})
	t.Run("delete survives cascade and duplicate never resurrects", func(t *testing.T) {
		tx, err := source.Begin(ctx)
		must(t, err)
		_, err = tx.Exec(ctx, `DELETE FROM core.page WHERE id=1`)
		must(t, err)
		must(t, QueuePage(ctx, tx, 1, ReasonDocumentDeleted))
		must(t, tx.Commit(ctx))
		queue(1)
		if got := batch(); got.Deleted != 2 {
			t.Fatal(got)
		}
		matches("giraffe", 0)
		var count int
		must(t, target.QueryRow(ctx, `SELECT count(*) FROM public.documents`).Scan(&count))
		if count != 0 {
			t.Fatal(count)
		}
	})

}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func execSQL(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string) {
	t.Helper()
	_, err := pool.Exec(ctx, sql)
	must(t, err)
}

// Apply the real XML through Liquibase, including native table/index changes and
// runtime grants. Do not maintain a second SQL representation in the test.
func applyChangelog(t *testing.T, ctx context.Context, pool *pgxpool.Pool, file, parameter, role string) {
	t.Helper()
	binary := os.Getenv("LIQUIBASE_BIN")
	if binary == "" {
		var err error
		binary, err = exec.LookPath("liquibase")
		if err != nil {
			t.Fatal("Liquibase is required for integration tests; set LIQUIBASE_BIN")
		}
	}
	path, err := filepath.Abs(file)
	must(t, err)
	cfg := pool.Config().ConnConfig
	cmd := exec.CommandContext(ctx, binary, "--changeLogFile="+filepath.Base(path), "--url="+fmt.Sprintf("jdbc:postgresql://%s:%d/%s?sslmode=disable", cfg.Host, cfg.Port, cfg.Database), "--username="+cfg.User, "--password="+cfg.Password, "update", "-D"+parameter+"="+role)
	cmd.Dir = filepath.Dir(path)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Liquibase migration %s failed: %v\n%s", file, err, output)
	}
}
