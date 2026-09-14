package editor

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/durgakiran/beskar/page"
	"github.com/durgakiran/beskar/space"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestPublishV2Postgres(t *testing.T) {
	dsn := os.Getenv("WHITEBOARD_PUBLISH_TEST_DSN")
	if dsn == "" {
		t.Skip("set WHITEBOARD_PUBLISH_TEST_DSN to disposable whiteboard_publish_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "whiteboard_publish_test" {
		t.Fatal("requires disposable whiteboard_publish_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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
	sql(`DROP TABLE IF EXISTS public.databasechangeloglock,public.databasechangelog; DROP SCHEMA IF EXISTS whiteboard CASCADE; DROP SCHEMA IF EXISTS core CASCADE;
 CREATE SCHEMA core;
 CREATE TABLE core.space(id uuid PRIMARY KEY,archived_at timestamptz,deleted_at timestamptz);
 CREATE TABLE core.page(id bigint PRIMARY KEY,space_id uuid NOT NULL REFERENCES core.space(id),owner_id uuid,parent_id bigint,type text DEFAULT 'whiteboard');
 CREATE TABLE core.page_doc_map(doc_id bigint,page_id bigint,title text,draft integer,version timestamptz);
 CREATE TABLE core.whiteboard_data(doc_id bigint,preview_asset_name text);
 CREATE SCHEMA IF NOT EXISTS project;
 CREATE TABLE IF NOT EXISTS project.projects(page_id bigint,title text);`)
	root, err := filepath.Abs("../../db/beskar")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	changelog := `<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd"><include file="updates/whiteboard_creation.xml"/><include file="updates/whiteboard_updates.xml"/><include file="updates/whiteboard_publication.xml"/><include file="updates/whiteboard_previews.xml"/><include file="updates/whiteboard_titles.xml"/><include file="updates/whiteboard_draft_replay.xml"/><include file="updates/whiteboard_history.xml"/></databaseChangeLog>`
	if err = os.WriteFile(filepath.Join(dir, "test.xml"), []byte(changelog), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "liquibase", "--defaults-file=/dev/null", "--search-path="+dir+","+root, "--changelog-file=test.xml", "--url=jdbc:postgresql://"+net.JoinHostPort(config.ConnConfig.Host, strconv.Itoa(int(config.ConnConfig.Port)))+"/whiteboard_publish_test", "--username="+config.ConnConfig.User, "update", "-Dapp_user="+pgx.Identifier{config.ConnConfig.User}.Sanitize())
	cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+config.ConnConfig.Password)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("migration: %v\n%s", err, out)
	}
	runtime, err := filepath.Abs("../whiteboard-runtime")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("WHITEBOARD_YJS_RUNTIME_DIR", runtime)
	// Generate actual ordered Yjs updates, including a future missing asset.
	generate := exec.CommandContext(ctx, "node", "--input-type=module", "-e", `import * as Y from 'yjs'; const d=new Y.Doc(),u=[];d.on('update',b=>u.push(Buffer.from(b).toString('base64')));d.getMap('glideboard-meta').set('title','First');d.getMap('glideboard-meta').set('title','Second');d.getMap('glideboard-records-v2').set('asset:a',new Y.Map(Object.entries({kind:'asset',type:'raster-image',props:{hash:'a'.repeat(64)}})));process.stdout.write(JSON.stringify(u));`)
	generate.Dir = runtime
	output, err := generate.Output()
	if err != nil {
		t.Fatal(err)
	}
	var encoded []string
	if err = json.Unmarshal(output, &encoded); err != nil {
		t.Fatal(err)
	}
	service := &whiteboardServiceV2{begin: func(ctx context.Context) (pgx.Tx, error) { return pool.Begin(ctx) }}
	in := whiteboardDraftInput{PageID: 42, SpaceID: uuid.New(), ActorID: uuid.New()}
	base := uuid.New()
	empty := []byte{0, 0}
	sql(`INSERT INTO core.space(id) VALUES($1)`, in.SpaceID)
	sql(`INSERT INTO core.page(id,space_id,owner_id) VALUES(42,$1,$2)`, in.SpaceID, in.ActorID)
	sql(whiteboardV2InsertBoard, in.PageID, in.ActorID)
	sql(whiteboardV2InsertSnapshot, base, in.PageID, empty, fmt.Sprintf("sha256:%x", sha256.Sum256(empty)), "Initial", in.ActorID)
	sql(whiteboardV2InsertDraft, in.PageID, base, in.ActorID)
	if _, err = service.GetPublishedWhiteboard(ctx, in); !errors.Is(err, errWhiteboardNotPublished) {
		t.Fatalf("unpublished: %v", err)
	}
	for index, encoded := range encoded {
		var title *string
		if index < 2 {
			value := []string{"First", "Second"}[index]
			title = &value
		}
		update, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = service.CheckpointWhiteboard(ctx, whiteboardCheckpointV2Input{Title: title, PageID: in.PageID, SpaceID: in.SpaceID, ActorID: in.ActorID, IdempotencyKey: uuid.New(), UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: update}); err != nil {
			t.Fatal(err)
		}
	}
	firstIn := whiteboardPublishInput{PreviewPNG: previewPNG(t, 255), whiteboardDraftInput: in, Sequence: 1, IdempotencyKey: uuid.New()}
	first, err := service.PublishWhiteboard(ctx, firstIn)
	if err != nil {
		t.Fatal(err)
	}
	if first.VersionNumber != 1 || first.Snapshot.ThroughSequence != 1 || first.Snapshot.Title != "First" {
		t.Fatalf("wrong boundary: %+v", first)
	}
	secondIn := whiteboardPublishInput{PreviewPNG: previewPNG(t, 0), whiteboardDraftInput: in, Sequence: 2, IdempotencyKey: uuid.New()}
	second, err := service.PublishWhiteboard(ctx, secondIn)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.PublishWhiteboard(ctx, firstIn)
	if err != nil || replay.VersionID != first.VersionID {
		t.Fatalf("retry: %+v %v", replay, err)
	}
	current, err := service.GetPublishedWhiteboard(ctx, in)
	if err != nil || current.VersionID != second.VersionID || current.Snapshot.Title != "Second" {
		t.Fatalf("pointer changed on retry: %+v %v", current, err)
	}
	preview, err := service.GetPublishedPreview(ctx, in)
	if err != nil || preview.Width != 2 || current.Preview == nil || preview.Digest != current.Preview.Digest {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	historical, err := service.GetVersionPreview(ctx, in, first.VersionID)
	if err != nil || historical.Digest == preview.Digest || historical.Digest != first.Preview.Digest {
		t.Fatalf("historical preview mixed versions: %+v %v", historical, err)
	}
	wrongPreview := in
	wrongPreview.SpaceID = uuid.New()
	if _, err = service.GetPublishedPreview(ctx, wrongPreview); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("cross-space preview: %v", err)
	}
	if _, err = service.GetVersionPreview(ctx, in, uuid.New()); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("unknown version preview: %v", err)
	}
	firstIn.PreviewPNG = previewPNG(t, 0)
	if _, err = service.PublishWhiteboard(ctx, firstIn); !errors.Is(err, errWhiteboardV2KeyReuse) {
		t.Fatalf("preview key reuse: %v", err)
	}
	firstIn.PreviewPNG = previewPNG(t, 255)
	firstIn.Sequence = 2
	if _, err = service.PublishWhiteboard(ctx, firstIn); !errors.Is(err, errWhiteboardV2KeyReuse) {
		t.Fatalf("key reuse: %v", err)
	}
	bad := whiteboardPublishInput{PreviewPNG: previewPNG(t, 255), whiteboardDraftInput: in, Sequence: 4, IdempotencyKey: uuid.New()}
	if _, err = service.PublishWhiteboard(ctx, bad); !errors.Is(err, errWhiteboardPublishSequence) {
		t.Fatalf("future: %v", err)
	}
	bad.Sequence = 3
	// Asset records must publish without any asset catalog or snapshot asset table.
	// Concurrent identical requests still create exactly one version.
	var count int
	var wg sync.WaitGroup
	results := make(chan whiteboardPublishedManifest, 2)
	failures := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := service.PublishWhiteboard(ctx, bad)
			results <- result
			failures <- err
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var last uuid.UUID
	for result := range results {
		if last != uuid.Nil && last != result.VersionID {
			t.Fatal("duplicate publication")
		}
		last = result.VersionID
		if result.VersionNumber != 3 {
			t.Fatalf("wrong version: %+v", result)
		}
	}
	stream, err := service.OpenPublishedSnapshot(ctx, in, first.VersionID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := io.ReadAll(stream.Content)
	stream.Content.Close()
	if err != nil {
		t.Fatal(err)
	}
	reconstructed, err := materializeWhiteboard(ctx, [][]byte{state}, first.Snapshot.Title)
	if err != nil || reconstructed.Title != "First" {
		t.Fatalf("download mixed publication: %+v %v", reconstructed, err)
	}
	wrong := in
	wrong.SpaceID = uuid.New()
	if _, err = service.GetPublishedWhiteboard(ctx, wrong); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("cross-space: %v", err)
	}

	// A database failure after inserting a version must roll back the entire publication.
	sql(`CREATE FUNCTION whiteboard.reject_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test pointer failure'; END $$;
 CREATE TRIGGER reject_pointer BEFORE UPDATE ON whiteboard.whiteboard FOR EACH ROW EXECUTE FUNCTION whiteboard.reject_pointer()`)
	failIn := whiteboardPublishInput{PreviewPNG: previewPNG(t, 255), whiteboardDraftInput: in, Sequence: 0, IdempotencyKey: uuid.New()}
	if _, err = service.PublishWhiteboard(ctx, failIn); err == nil {
		t.Fatal("expected pointer failure")
	}
	sql(`DROP TRIGGER reject_pointer ON whiteboard.whiteboard; DROP FUNCTION whiteboard.reject_pointer()`)
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_version`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("version escaped rollback: %d %v", count, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_version_preview`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("preview escaped rollback: %d %v", count, err)
	}
	current, err = service.GetPublishedWhiteboard(ctx, in)
	if err != nil || current.VersionID != last {
		t.Fatalf("pointer escaped rollback: %+v %v", current, err)
	}
	rowsBeforeRename, err := pool.Query(ctx, space.GET_PAGE_LIST_QUERY, in.SpaceID, []string{"42"}, []string{"42"})
	if err != nil {
		t.Fatal(err)
	}
	cleanEntries, err := pgx.CollectRows[space.PageList](rowsBeforeRename, pgx.RowToStructByNameLax[space.PageList])
	if err != nil || len(cleanEntries) != 1 || cleanEntries[0].Draft != 0 {
		t.Fatalf("published board should navigate to preview: %+v %v", cleanEntries, err)
	}
	// A title-only checkpoint advances the same sequence with an empty Yjs update.
	renamed := "Draft only rename"
	renameInput := whiteboardCheckpointV2Input{PageID: in.PageID, SpaceID: in.SpaceID, ActorID: in.ActorID, IdempotencyKey: uuid.New(), UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: []byte{0, 0}, Title: &renamed}
	renamedResult, err := service.CheckpointWhiteboard(ctx, renameInput)
	if err != nil || renamedResult.Sequence != 4 {
		t.Fatalf("rename: %+v %v", renamedResult, err)
	}
	manifest, err := service.GetDraft(ctx, in)
	if err != nil || manifest.Title != renamed || manifest.BaseSnapshot.Title != "Initial" {
		t.Fatalf("draft title: %+v %v", manifest, err)
	}
	replayURL, err := url.Parse(manifest.UpdatesURL)
	if err != nil {
		t.Fatal(err)
	}
	replayPage, err := service.GetDraftUpdates(ctx, in, replayURL.Query().Get("cursor"))
	if err != nil || len(replayPage.Updates) != 4 || replayPage.Updates[3].Title == nil || *replayPage.Updates[3].Title != renamed {
		t.Fatalf("replay title: %+v %v", replayPage, err)
	}
	var viewTitle string
	var publishedAt *time.Time
	if err := pool.QueryRow(ctx, getV2WhiteboardViewMeta, in.PageID, true).Scan(&viewTitle, &publishedAt); err != nil || viewTitle != "Second" || publishedAt == nil {
		t.Fatalf("published view metadata: %q %v %v", viewTitle, publishedAt, err)
	}
	for _, editable := range []bool{false, true} {
		ids := []string{}
		want := "Second"
		if editable {
			ids = []string{"42"}
			want = renamed
		}
		rows, err := pool.Query(ctx, space.GET_PAGE_LIST_QUERY, in.SpaceID, []string{"42"}, ids)
		if err != nil {
			t.Fatal(err)
		}
		entries, err := pgx.CollectRows[space.PageList](rows, pgx.RowToStructByNameLax[space.PageList])
		if err != nil || len(entries) != 1 {
			t.Fatalf("list mapping: %+v %v", entries, err)
		}
		entry := entries[0]
		wantDraft := int8(0)
		if editable {
			wantDraft = 1
		}
		if entry.Draft != wantDraft {
			t.Fatalf("draft navigation: %+v", entry)
		}
		if entry.Title != want || entry.ContentAPIVersion != 2 || entry.CanEdit != editable || entry.PublishedVersionID == nil || !entry.HasPreview || entry.ParentId != 0 {
			t.Fatalf("list metadata: %+v", entry)
		}
		var id int64
		var parent *int64
		var title, typ string
		crumbs, err := pool.Query(ctx, page.GET_PAGE_BREAD_CRUMBS, in.PageID, ids)
		if err != nil {
			t.Fatal(err)
		}
		if !crumbs.Next() {
			crumbs.Close()
			t.Fatal("missing breadcrumb")
		}
		if err = crumbs.Scan(&id, &parent, &title); err != nil {
			crumbs.Close()
			t.Fatal(err)
		}
		crumbs.Close()
		if title != want {
			t.Fatalf("breadcrumb editor=%v: %q", editable, title)
		}
		var spaceID uuid.UUID
		var previewName string
		var contentVersion int
		var publishedID *uuid.UUID
		var hasPreview bool
		if err = pool.QueryRow(ctx, getPageInlineLinkMetadata, in.PageID, in.SpaceID, editable).Scan(&id, &typ, &spaceID, &title, &previewName, &contentVersion, &publishedID, &hasPreview); err != nil || title != want || contentVersion != 2 || publishedID == nil || !hasPreview {
			t.Fatalf("inline title editor=%v: %q %v", editable, title, err)
		}
	}
	// A newly created v2 board has no legacy document rows and must still be discoverable to editors.
	sql(`INSERT INTO core.page(id,space_id,owner_id) VALUES(43,$1,$2)`, in.SpaceID, in.ActorID)
	sql(whiteboardV2InsertBoard, int64(43), in.ActorID)
	newSnapshot := uuid.New()
	sql(whiteboardV2InsertSnapshot, newSnapshot, int64(43), empty, fmt.Sprintf("sha256:%x", sha256.Sum256(empty)), "New board", in.ActorID)
	sql(whiteboardV2InsertDraft, int64(43), newSnapshot, in.ActorID)
	for _, editable := range []bool{false, true} {
		ids := []string{}
		wantCount := 1
		if editable {
			ids = []string{"43"}
			wantCount = 2
		}
		rows, err := pool.Query(ctx, space.GET_PAGE_LIST_QUERY, in.SpaceID, []string{"42", "43"}, ids)
		if err != nil {
			t.Fatal(err)
		}
		entries, err := pgx.CollectRows[space.PageList](rows, pgx.RowToStructByNameLax[space.PageList])
		if err != nil || len(entries) != wantCount {
			t.Fatalf("unpublished listing: %+v %v", entries, err)
		}
		var metadata PageMetadata
		var preview bool
		err = pool.QueryRow(ctx, getPageMetadata, int64(43), in.SpaceID, editable).Scan(&metadata.Id, &metadata.Type, &metadata.SpaceId, &metadata.ContentAPIVersion, &metadata.PublishedVersionID, &preview)
		if !editable && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("viewer discovered draft: %v", err)
		}
		if editable && (err != nil || metadata.ContentAPIVersion != 2 || metadata.Type != "whiteboard" || metadata.PublishedVersionID != nil) {
			t.Fatalf("draft metadata: %+v %v", metadata, err)
		}
	}
	// Permission lookup IDs and SQL space membership jointly scope discovery.
	rows, err := pool.Query(ctx, space.GET_PAGE_LIST_QUERY, in.SpaceID, []string{"42"}, []string{"43"})
	if err != nil {
		t.Fatal(err)
	}
	visible, err := pgx.CollectRows[space.PageList](rows, pgx.RowToStructByNameLax[space.PageList])
	if err != nil || len(visible) != 1 || visible[0].PageId != 42 {
		t.Fatalf("permission filtering: %+v %v", visible, err)
	}
	rows, err = pool.Query(ctx, space.GET_PAGE_LIST_QUERY, uuid.New(), []string{"42", "43"}, []string{"43"})
	if err != nil {
		t.Fatal(err)
	}
	visible, err = pgx.CollectRows[space.PageList](rows, pgx.RowToStructByNameLax[space.PageList])
	if err != nil || len(visible) != 0 {
		t.Fatal("cross-space discovery")
	}
	sql(`INSERT INTO core.page(id,space_id,owner_id,type) VALUES(44,$1,$2,'document')`, in.SpaceID, in.ActorID)
	sql(`INSERT INTO core.page_doc_map(doc_id,page_id,title,draft,version) VALUES(44,44,'Legacy document',0,now())`)
	rows, err = pool.Query(ctx, space.GET_PAGE_LIST_QUERY, in.SpaceID, []string{"44"}, []string{})
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := pgx.CollectRows[space.PageList](rows, pgx.RowToStructByNameLax[space.PageList])
	if err != nil || len(legacy) != 1 || legacy[0].ContentAPIVersion != 1 || legacy[0].Title != "Legacy document" {
		t.Fatalf("legacy discovery: %+v %v", legacy, err)
	}
	current, err = service.GetPublishedWhiteboard(ctx, in)
	if err != nil || current.Snapshot.Title != "Second" {
		t.Fatalf("rename changed publication: %+v %v", current, err)
	}
	sql(`UPDATE core.space SET archived_at=now()`)
	if _, err = service.GetPublishedWhiteboard(ctx, in); err != nil {
		t.Fatal("archive hid published read", err)
	}
	if _, err = service.PublishWhiteboard(ctx, bad); err != nil {
		t.Fatal("archive broke receipt", err)
	}
	bad.IdempotencyKey = uuid.New()
	if _, err = service.PublishWhiteboard(ctx, bad); !errors.Is(err, errWhiteboardV2Archived) {
		t.Fatalf("archived write: %v", err)
	}
	// History and lifecycle operations use the same real schema and locks.
	sql(`UPDATE core.space SET archived_at=NULL`)
	history, err := service.ListWhiteboardVersions(ctx, in, 0, 2)
	if err != nil || len(history.Versions) != 2 || history.NextBefore == nil {
		t.Fatalf("history page: %+v %v", history, err)
	}
	before, _ := strconv.ParseInt(*history.NextBefore, 10, 64)
	tail, err := service.ListWhiteboardVersions(ctx, in, before, 2)
	if err != nil || len(tail.Versions) != 1 || tail.NextBefore != nil {
		t.Fatalf("history tail: %+v %v", tail, err)
	}
	versionMetadata, err := service.GetWhiteboardVersion(ctx, in, first.VersionID)
	if err != nil || versionMetadata.Snapshot.Title != "First" || versionMetadata.Preview == nil {
		t.Fatalf("versionMetadata metadata: %+v %v", versionMetadata, err)
	}
	if _, err = service.GetWhiteboardVersion(ctx, wrong, first.VersionID); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("cross-space history: %v", err)
	}
	restore := whiteboardRestoreInput{whiteboardDraftInput: in, VersionID: first.VersionID, ExpectedHead: 4, IdempotencyKey: uuid.New()}

	invalidRestore := restore
	invalidRestore.VersionID = uuid.New()
	if _, err = service.RestoreWhiteboardVersion(ctx, invalidRestore); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("missing restore version: %v", err)
	}
	sql(`CREATE FUNCTION whiteboard.reject_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'restore rollback test'; END $$; CREATE TRIGGER reject_restore BEFORE UPDATE ON whiteboard.whiteboard_draft FOR EACH ROW EXECUTE FUNCTION whiteboard.reject_restore()`)
	var snapshotsBefore int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_snapshot WHERE page_id=$1`, in.PageID).Scan(&snapshotsBefore); err != nil {
		t.Fatal(err)
	}
	if _, err = service.RestoreWhiteboardVersion(ctx, restore); err == nil {
		t.Fatal("restore should fail")
	}
	var snapshotsAfter int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_snapshot WHERE page_id=$1`, in.PageID).Scan(&snapshotsAfter); err != nil || snapshotsAfter != snapshotsBefore {
		t.Fatal("restore snapshot escaped rollback", err)
	}
	sql(`DROP TRIGGER reject_restore ON whiteboard.whiteboard_draft; DROP FUNCTION whiteboard.reject_restore()`)
	restored, err := service.RestoreWhiteboardVersion(ctx, restore)
	if err != nil || restored.Sequence != 5 || restored.RestoreGeneration != 1 {
		t.Fatalf("restore: %+v %v", restored, err)
	}
	retryRestore, err := service.RestoreWhiteboardVersion(ctx, restore)
	if err != nil || retryRestore != restored {
		t.Fatalf("restore retry: %+v %v", retryRestore, err)
	}
	changedRestore := restore
	changedRestore.VersionID = last
	if _, err = service.RestoreWhiteboardVersion(ctx, changedRestore); !errors.Is(err, errWhiteboardV2KeyReuse) {
		t.Fatalf("restore key reuse: %v", err)
	}
	manifest, err = service.GetDraft(ctx, in)
	if err != nil || manifest.Title != "First" || manifest.RestoreGeneration != 1 || manifest.BaseSnapshot.ThroughSequence != 5 {
		t.Fatalf("restored draft: %+v %v", manifest, err)
	}
	current, err = service.GetPublishedWhiteboard(ctx, in)
	if err != nil || current.VersionID != last {
		t.Fatalf("restore moved publication: %+v %v", current, err)
	}
	renameInput.IdempotencyKey = uuid.New()
	if _, err = service.CheckpointWhiteboard(ctx, renameInput); !errors.Is(err, errWhiteboardRestored) {
		t.Fatalf("stale client accepted: %v", err)
	}
	renameInput.RestoreGeneration = 1
	if _, err = service.CheckpointWhiteboard(ctx, renameInput); err != nil {
		t.Fatalf("new generation checkpoint: %v", err)
	}
	// Two restores of the same observed head cannot overwrite each other.
	restore.ExpectedHead = 6
	restoreResults := make(chan error, 2)
	for i := 0; i < 2; i++ {
		candidate := restore
		candidate.IdempotencyKey = uuid.New()
		go func() { _, e := service.RestoreWhiteboardVersion(ctx, candidate); restoreResults <- e }()
	}
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		e := <-restoreResults
		if e == nil {
			successes++
		} else if errors.Is(e, errWhiteboardHeadChanged) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("restore race: %d/%d", successes, conflicts)
	}
	oldPublish := whiteboardPublishInput{whiteboardDraftInput: in, Sequence: 4, IdempotencyKey: uuid.New(), PreviewPNG: previewPNG(t, 255)}
	if _, err = service.PublishWhiteboard(ctx, oldPublish); !errors.Is(err, errWhiteboardPublishSequence) {
		t.Fatalf("pre-restore publish accepted: %v", err)
	}
	oldPublish.Sequence = 7
	freshPublication, err := service.PublishWhiteboard(ctx, oldPublish)
	if err != nil || freshPublication.Snapshot.Title != "First" {
		t.Fatalf("publish restored state: %+v %v", freshPublication, err)
	}
	sql(`UPDATE core.page SET parent_id=42 WHERE id=44`)
	if err = service.DeleteWhiteboardV2(ctx, in); !errors.Is(err, errWhiteboardHasChildren) {
		t.Fatalf("deleted parent: %v", err)
	}
	sql(`UPDATE core.page SET parent_id=NULL WHERE id=44`)
	// Keep creation identity as a tombstone after removing all content.
	createKey := uuid.New()
	sql(`INSERT INTO whiteboard.whiteboard_create_receipt(actor_id,space_id,idempotency_key,request_hash,page_id) VALUES($1,$2,$3,$4,$5)`, in.ActorID, in.SpaceID, createKey, "sha256:"+fmt.Sprintf("%064d", 0), in.PageID)
	sql(`UPDATE core.space SET archived_at=now()`)
	if err = service.DeleteWhiteboardV2(ctx, in); !errors.Is(err, errWhiteboardV2Archived) {
		t.Fatalf("archived delete: %v", err)
	}
	sql(`UPDATE core.space SET archived_at=NULL`)
	if err = service.DeleteWhiteboardV2(ctx, in); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err = service.GetDraft(ctx, in); !errors.Is(err, errWhiteboardV2BoardNotFound) {
		t.Fatalf("deleted draft visible: %v", err)
	}
	for _, table := range []string{"whiteboard", "whiteboard_draft", "whiteboard_snapshot", "whiteboard_update", "whiteboard_version", "whiteboard_title_update", "whiteboard_draft_replay", "whiteboard_restore_receipt"} {
		var remaining int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM whiteboard.`+table+` WHERE page_id=$1`, in.PageID).Scan(&remaining); err != nil || remaining != 0 {
			t.Fatalf("delete retained %s: %d %v", table, remaining, err)
		}
	}
	var tombstone int64
	var tombstoneHash string
	if err = pool.QueryRow(ctx, whiteboardV2GetReceipt, in.ActorID, in.SpaceID, createKey).Scan(&tombstoneHash, &tombstone); err != nil || tombstone != 0 {
		t.Fatalf("create tombstone: %d %v", tombstone, err)
	}

}
