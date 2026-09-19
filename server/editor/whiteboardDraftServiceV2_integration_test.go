package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	osexec "os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run only against an explicitly supplied disposable database. The required name
// prevents accidental execution against an application database.
func TestDraftV2Postgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_DRAFT_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_DRAFT_TEST_DSN to a disposable whiteboard_draft_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_draft_test" {
		t.Fatal("integration test requires database whiteboard_draft_test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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
	exec(`DROP TABLE IF EXISTS public.databasechangeloglock, public.databasechangelog;
 DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS core CASCADE;
 CREATE SCHEMA core; CREATE SCHEMA whiteboard;
 CREATE TABLE core.space(id uuid PRIMARY KEY, archived_at timestamptz, deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL REFERENCES core.space(id));
 CREATE TABLE whiteboard.whiteboard(page_id bigint PRIMARY KEY REFERENCES core.page(id));
 CREATE TABLE whiteboard.whiteboard_snapshot(id uuid PRIMARY KEY,page_id bigint NOT NULL REFERENCES whiteboard.whiteboard(page_id) ON DELETE CASCADE,through_sequence bigint NOT NULL,title text NOT NULL,state_bytes bytea NOT NULL,state_digest text NOT NULL,UNIQUE(page_id,id));
 CREATE TABLE whiteboard.whiteboard_draft(page_id bigint PRIMARY KEY REFERENCES whiteboard.whiteboard(page_id) ON DELETE CASCADE,base_snapshot_id uuid NOT NULL REFERENCES whiteboard.whiteboard_snapshot(id),head_sequence bigint NOT NULL,updated_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE whiteboard.whiteboard_update(id uuid PRIMARY KEY,page_id bigint NOT NULL REFERENCES whiteboard.whiteboard(page_id) ON DELETE CASCADE,sequence bigint NOT NULL,update_encoding text NOT NULL,update_bytes bytea NOT NULL,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,UNIQUE(page_id,sequence),UNIQUE(page_id,actor_id,idempotency_key));`)
	// Run Liquibase itself so XML changes and SQL functions are both applied.
	liquibase, err := osexec.LookPath("liquibase")
	if err != nil {
		t.Fatal("the PostgreSQL integration test requires Liquibase on PATH")
	}
	searchPath, err := filepath.Abs("../../db/beskar")
	if err != nil {
		t.Fatal(err)
	}
	migrate := func(command ...string) {
		t.Helper()
		args := []string{"--defaults-file=/dev/null", "--search-path=" + searchPath,
			"--changelog-file=updates/whiteboard_draft_replay.xml",
			"--url=jdbc:postgresql://" + net.JoinHostPort(config.ConnConfig.Host, strconv.Itoa(int(config.ConnConfig.Port))) + "/whiteboard_draft_test",
			"--username=" + config.ConnConfig.User}
		args = append(args, command...)
		args = append(args, "-Dapp_user="+pgx.Identifier{config.ConnConfig.User}.Sanitize())
		cmd := osexec.CommandContext(ctx, liquibase, args...)
		cmd.Dir = t.TempDir()
		cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+config.ConnConfig.Password)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("Liquibase %s failed: %v\n%s", command[0], err, output)
		}
	}
	migrate("update")
	// The replay fixture uses the same title table shape; publication integration
	// separately applies and verifies the actual XML title migration.
	exec(`CREATE TABLE whiteboard.whiteboard_title_update(page_id bigint NOT NULL,sequence bigint NOT NULL,title text NOT NULL,PRIMARY KEY(page_id,sequence),FOREIGN KEY(page_id,sequence) REFERENCES whiteboard.whiteboard_update(page_id,sequence))`)

	service := &whiteboardServiceV2{begin: func(ctx context.Context) (pgx.Tx, error) {
		return pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	}}
	in := whiteboardDraftInput{PageID: 42, SpaceID: uuid.New(), ActorID: uuid.New()}
	snapshot := uuid.New()
	state := bytes.Repeat([]byte{1, 2, 3, 4, 5}, 150000)
	exec(`INSERT INTO core.space(id) VALUES($1)`, in.SpaceID)
	exec(`INSERT INTO core.page VALUES($1,$2)`, in.PageID, in.SpaceID)
	exec(`INSERT INTO whiteboard.whiteboard VALUES($1)`, in.PageID)
	exec(`INSERT INTO whiteboard.whiteboard_snapshot VALUES($1,$2,0,'Draft',$3,$4)`, snapshot, in.PageID, state, fmt.Sprintf("sha256:%x", sha256.Sum256(state)))
	exec(`INSERT INTO whiteboard.whiteboard_draft(page_id,base_snapshot_id,head_sequence,updated_by) VALUES($1,$2,6,$3)`, in.PageID, snapshot, in.ActorID)
	for sequence := int64(1); sequence <= 6; sequence++ {
		exec(whiteboardV2CheckpointInsert, uuid.New(), in.PageID, sequence, in.ActorID, uuid.New(), bytes.Repeat([]byte{byte(sequence)}, 1024*1024), whiteboardUpdateEncodingV1, "hash")
	}
	manifest, err := service.GetDraft(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.HeadSequence != 6 || manifest.BaseSnapshot.ByteLength != int64(len(state)) || time.Until(manifest.ExpiresAt) < 59*time.Minute {
		t.Fatalf("bad manifest %+v", manifest)
	}
	download, _ := url.Parse(manifest.BaseSnapshot.DownloadURL)
	replayID := uuid.MustParse(download.Query().Get("replay"))
	updatesURL, _ := url.Parse(manifest.UpdatesURL)
	cursor := updatesURL.Query().Get("cursor")
	first, err := service.GetDraftUpdates(ctx, in, cursor)
	if err != nil || len(first.Updates) != 4 || first.Complete || first.NextCursor == nil {
		t.Fatalf("first page %+v err=%v", len(first.Updates), err)
	}
	// A save after capture must not move this replay's head or enter its pages.
	_, err = service.CheckpointWhiteboard(ctx, whiteboardCheckpointV2Input{PageID: in.PageID, SpaceID: in.SpaceID, ActorID: in.ActorID, IdempotencyKey: uuid.New(), UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: []byte{0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.GetDraftUpdates(ctx, in, *first.NextCursor)
	if err != nil || len(second.Updates) != 2 || !second.Complete || second.HeadSequence != 6 || second.NextCursor != nil {
		t.Fatalf("second page count=%d complete=%v head=%d err=%v", len(second.Updates), second.Complete, second.HeadSequence, err)
	}
	again, err := service.GetDraftUpdates(ctx, in, cursor)
	if err != nil || !bytes.Equal(first.Updates[0].Update, again.Updates[0].Update) || *first.NextCursor != *again.NextCursor {
		t.Fatal("page retry changed")
	}
	forged, _ := base64.RawURLEncoding.DecodeString(cursor)
	forged[23]++
	if _, err = service.GetDraftUpdates(ctx, in, base64.RawURLEncoding.EncodeToString(forged)); !errors.Is(err, errWhiteboardDraftCursor) {
		t.Fatal("forged cursor accepted", err)
	}
	other := in
	other.ActorID = uuid.New()
	if _, err = service.GetDraftUpdates(ctx, other, cursor); !errors.Is(err, errWhiteboardDraftExpired) {
		t.Fatal("actor scope escaped", err)
	}
	other = in
	other.SpaceID = uuid.New()
	if _, err = service.GetDraftUpdates(ctx, other, cursor); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatal("space scope escaped", err)
	}
	if _, err = service.OpenDraftSnapshot(ctx, in, uuid.New(), replayID); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatal("snapshot scope escaped", err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM whiteboard.whiteboard_update WHERE page_id=$1 AND sequence=1`, in.PageID); err == nil {
		t.Fatal("active replay did not retain update")
	}
	stream, err := service.OpenDraftSnapshot(ctx, in, snapshot, replayID)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(stream.Content)
	if err != nil || !bytes.Equal(data, state) {
		t.Fatal("chunked read differs", err)
	}
	if _, err = stream.Content.Seek(whiteboardSnapshotChunkBytes-3, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	data = make([]byte, 12)
	if _, err = io.ReadFull(stream.Content, data); err != nil || !bytes.Equal(data, state[whiteboardSnapshotChunkBytes-3:whiteboardSnapshotChunkBytes+9]) {
		t.Fatal("range across chunk boundary differs", err)
	}
	// Expiring a lease makes new requests fail, while the open MVCC stream remains
	// valid through compaction and deletion of its source rows.
	exec(`UPDATE whiteboard.whiteboard_draft_replay SET expires_at=now()-interval '1 second'`)
	if _, err = service.GetDraftUpdates(ctx, in, cursor); !errors.Is(err, errWhiteboardDraftExpired) {
		t.Fatal("expired cursor accepted", err)
	}
	nextSnapshot := uuid.New()
	exec(`INSERT INTO whiteboard.whiteboard_snapshot VALUES($1,$2,7,'Compacted',$3,$4)`, nextSnapshot, in.PageID, []byte{0, 0}, fmt.Sprintf("sha256:%x", sha256.Sum256([]byte{0, 0})))
	exec(`UPDATE whiteboard.whiteboard_draft SET base_snapshot_id=$1 WHERE page_id=$2`, nextSnapshot, in.PageID)
	if _, err = pool.Exec(ctx, `DELETE FROM whiteboard.whiteboard_snapshot WHERE id=$1`, snapshot); err == nil {
		t.Fatal("snapshot FK did not retain snapshot until expired lease cleanup")
	}
	exec(whiteboardV2ReplayCleanup, in.PageID)
	exec(`DELETE FROM whiteboard.whiteboard_snapshot WHERE id=$1`, snapshot)
	exec(`DELETE FROM whiteboard.whiteboard_update WHERE page_id=$1 AND sequence<=7`, in.PageID)
	_, err = stream.Content.Seek(0, io.SeekStart)
	if err != nil {
		t.Fatal(err)
	}
	data, err = io.ReadAll(stream.Content)
	if err != nil || !bytes.Equal(data, state) {
		t.Fatal("in-flight stream broken by compaction", err)
	}
	stream.Content.Close()
	// Archived spaces permit reads. A compacted draft needs no incremental rows.
	exec(`UPDATE core.space SET archived_at=now() WHERE id=$1`, in.SpaceID)
	compact, err := service.GetDraft(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(compact.UpdatesURL)
	empty, err := service.GetDraftUpdates(ctx, in, u.Query().Get("cursor"))
	if err != nil || !empty.Complete || len(empty.Updates) != 0 {
		t.Fatal("empty compacted replay", err)
	}
	exec(`UPDATE core.space SET archived_at=NULL WHERE id=$1`, in.SpaceID)
	// Count limit protects pages containing many tiny updates.
	for sequence := int64(8); sequence <= 77; sequence++ {
		exec(whiteboardV2CheckpointInsert, uuid.New(), in.PageID, sequence, in.ActorID, uuid.New(), []byte{0, 0}, whiteboardUpdateEncodingV1, "hash")
	}
	exec(`UPDATE whiteboard.whiteboard_draft SET head_sequence=77 WHERE page_id=$1`, in.PageID)
	many, err := service.GetDraft(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	u, _ = url.Parse(many.UpdatesURL)
	page, err := service.GetDraftUpdates(ctx, in, u.Query().Get("cursor"))
	if err != nil || len(page.Updates) != 64 || page.Complete {
		t.Fatal("count limit", len(page.Updates), err)
	}
	// Corrupt stored sequence coverage must fail closed, never claim completion.
	exec(`UPDATE whiteboard.whiteboard_update SET sequence=100 WHERE page_id=$1 AND sequence=74`, in.PageID)
	if _, err = service.GetDraftUpdates(ctx, in, *page.NextCursor); !errors.Is(err, errWhiteboardDraftIntegrity) {
		t.Fatal("sequence gap accepted", err)
	}
	exec(`UPDATE core.space SET deleted_at=now() WHERE id=$1`, in.SpaceID)
	if _, err = service.GetDraft(ctx, in); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatal("deleted space exposed", err)
	}
	// Verify the shipped XML/SQL rollback through Liquibase too.
	migrate("rollback-count", "--count=2")
}
