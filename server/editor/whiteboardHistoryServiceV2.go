package editor

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"math"
	"strconv"
)

var errWhiteboardRestored = errors.New("The draft was restored. Reopen the board before editing.")
var errWhiteboardHeadChanged = errors.New("The draft changed. Refresh its head before restoring.")
var errWhiteboardHasChildren = errors.New("Move or delete child pages before deleting this whiteboard.")

type whiteboardVersionList struct {
	Versions   []whiteboardPublishedManifest `json:"versions"`
	NextBefore *string                       `json:"nextBefore,omitempty"`
}
type whiteboardRestoreInput struct {
	whiteboardDraftInput
	VersionID, IdempotencyKey uuid.UUID
	ExpectedHead              int64
}
type whiteboardRestoreResult struct {
	PageID            int64     `json:"pageId"`
	VersionID         uuid.UUID `json:"versionId"`
	SnapshotID        uuid.UUID `json:"snapshotId"`
	Sequence          int64     `json:"sequence,string"`
	RestoreGeneration int64     `json:"restoreGeneration,string"`
}

func (s *whiteboardServiceV2) GetWhiteboardVersion(ctx context.Context, in whiteboardDraftInput, version uuid.UUID) (whiteboardPublishedManifest, error) {
	tx, _, err := s.beginPublished(ctx, in)
	if err != nil {
		return whiteboardPublishedManifest{}, err
	}
	defer draftRollback(ctx, tx)
	return readPublishedManifest(ctx, tx, in, version)
}
func (s *whiteboardServiceV2) ListWhiteboardVersions(ctx context.Context, in whiteboardDraftInput, before int64, limit int) (whiteboardVersionList, error) {
	result := whiteboardVersionList{Versions: []whiteboardPublishedManifest{}}
	tx, _, err := s.beginPublished(ctx, in)
	if err != nil {
		return result, err
	}
	defer draftRollback(ctx, tx)
	rows, err := tx.Query(ctx, `SELECT id FROM whiteboard.whiteboard_version WHERE page_id=$1 AND ($2::bigint=0 OR version_number<$2) ORDER BY version_number DESC LIMIT $3`, in.PageID, before, limit+1)
	if err != nil {
		return result, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return result, err
	}
	more := len(ids) > limit
	if more {
		ids = ids[:limit]
	}
	for _, id := range ids {
		m, e := readPublishedManifest(ctx, tx, in, id)
		if e != nil {
			return result, e
		}
		result.Versions = append(result.Versions, m)
	}
	if more {
		cursor := strconv.FormatInt(result.Versions[len(result.Versions)-1].VersionNumber, 10)
		result.NextBefore = &cursor
	}
	return result, nil
}

// Space -> page/board -> draft is shared with checkpoint and publication locking.
func (s *whiteboardServiceV2) beginHistoryWrite(ctx context.Context, in whiteboardDraftInput) (pgx.Tx, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	fail := func(e error) (pgx.Tx, error) { draftRollback(ctx, tx); return nil, e }
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return fail(err)
	}
	var archived, deleted bool
	if err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted); errors.Is(err, pgx.ErrNoRows) || deleted {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	if archived {
		return fail(errWhiteboardV2Archived)
	}
	var id int64
	if err = tx.QueryRow(ctx, `SELECT w.page_id FROM whiteboard.whiteboard w JOIN core.page p ON p.id=w.page_id WHERE w.page_id=$1 AND p.space_id=$2 FOR UPDATE OF p,w`, in.PageID, in.SpaceID).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	return tx, nil
}
func (s *whiteboardServiceV2) RestoreWhiteboardVersion(ctx context.Context, in whiteboardRestoreInput) (whiteboardRestoreResult, error) {
	out := whiteboardRestoreResult{PageID: in.PageID, VersionID: in.VersionID}
	tx, err := s.beginHistoryWrite(ctx, in.whiteboardDraftInput)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	var storedVersion uuid.UUID
	var expected int64
	err = tx.QueryRow(ctx, `SELECT version_id,expected_head,sequence,restore_generation,snapshot_id FROM whiteboard.whiteboard_restore_receipt WHERE page_id=$1 AND actor_id=$2 AND idempotency_key=$3`, in.PageID, in.ActorID, in.IdempotencyKey).Scan(&storedVersion, &expected, &out.Sequence, &out.RestoreGeneration, &out.SnapshotID)
	if err == nil {
		if storedVersion != in.VersionID || expected != in.ExpectedHead {
			return out, errWhiteboardV2KeyReuse
		}
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	var head, generation int64
	if err = tx.QueryRow(ctx, whiteboardV2CheckpointLockDraft, in.PageID).Scan(&head, &generation); err != nil {
		return out, err
	}
	if head != in.ExpectedHead {
		return out, errWhiteboardHeadChanged
	}
	if head == math.MaxInt64 || generation == math.MaxInt64 {
		return out, errWhiteboardPublishSequence
	}
	var sourceSnapshot uuid.UUID
	var sourceState []byte
	var sourceTitle, sourceDigest string
	err = tx.QueryRow(ctx, `SELECT s.id,s.state_bytes,s.title,s.state_digest FROM whiteboard.whiteboard_version v
 JOIN whiteboard.whiteboard_snapshot s ON s.page_id=v.page_id AND s.id=v.snapshot_id WHERE v.page_id=$1 AND v.id=$2`, in.PageID, in.VersionID).Scan(&sourceSnapshot, &sourceState, &sourceTitle, &sourceDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return out, err
	}
	if len(sourceState) > whiteboardPublishMaxBytes {
		return out, errWhiteboardPublishLimit
	}
	if fmt.Sprintf("sha256:%x", sha256.Sum256(sourceState)) != sourceDigest {
		return out, errWhiteboardPublishState
	}
	materialize := s.materialize
	if materialize == nil {
		materialize = materializeWhiteboard
	}
	full, err := materialize(ctx, [][]byte{sourceState}, sourceTitle)
	if err != nil {
		return out, err
	}
	if err = associateWhiteboardSnapshotAssets(ctx, tx, in.PageID, sourceSnapshot, sourceDigest, full); err != nil {
		return out, err
	}
	out.Sequence = head + 1
	out.RestoreGeneration = generation + 1
	out.SnapshotID = uuid.New()
	tag, err := tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_snapshot(id,page_id,through_sequence,title,state_bytes,state_digest,created_by)
 SELECT $3,v.page_id,$4,s.title,s.state_bytes,s.state_digest,$5 FROM whiteboard.whiteboard_version v JOIN whiteboard.whiteboard_snapshot s ON s.page_id=v.page_id AND s.id=v.snapshot_id WHERE v.page_id=$1 AND v.id=$2`, in.PageID, in.VersionID, out.SnapshotID, out.Sequence, in.ActorID)
	if err != nil {
		return out, err
	}
	if tag.RowsAffected() != 1 {
		return out, errWhiteboardV2BoardNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_snapshot_asset(snapshot_id,page_id,content_hash)
 SELECT $3,page_id,content_hash FROM whiteboard.whiteboard_snapshot_asset WHERE page_id=$1 AND snapshot_id=$2`, in.PageID, sourceSnapshot, out.SnapshotID); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_snapshot_asset_manifest(snapshot_id,page_id,state_digest,extractor_version,completed_at)
 SELECT $3,page_id,state_digest,extractor_version,now() FROM whiteboard.whiteboard_snapshot_asset_manifest WHERE page_id=$1 AND snapshot_id=$2`, in.PageID, sourceSnapshot, out.SnapshotID); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_draft SET base_snapshot_id=$2,head_sequence=$3,restore_generation=$4,updated_by=$5,updated_at=now() WHERE page_id=$1`, in.PageID, out.SnapshotID, out.Sequence, out.RestoreGeneration, in.ActorID); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_restore_receipt(page_id,actor_id,idempotency_key,version_id,expected_head,sequence,restore_generation,snapshot_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, in.PageID, in.ActorID, in.IdempotencyKey, in.VersionID, in.ExpectedHead, out.Sequence, out.RestoreGeneration, out.SnapshotID); err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	return out, nil
}
func (s *whiteboardServiceV2) DeleteWhiteboardV2(ctx context.Context, in whiteboardDraftInput) error {
	tx, err := s.beginHistoryWrite(ctx, in)
	if err != nil {
		return err
	}
	defer draftRollback(ctx, tx)
	var children bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core.page WHERE space_id=$1 AND parent_id=$2)`, in.SpaceID, in.PageID).Scan(&children); err != nil {
		return err
	}
	if children {
		return errWhiteboardHasChildren
	}
	if err = queueWhiteboardAssetDeletionV2(ctx, tx, in); err != nil {
		return err
	}
	statements := []string{
		`UPDATE whiteboard.whiteboard SET published_version_id=NULL WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_version_preview WHERE version_id IN (SELECT id FROM whiteboard.whiteboard_version WHERE page_id=$1)`,
		`DELETE FROM whiteboard.whiteboard_version WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_draft_replay WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_draft WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_title_update WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard WHERE page_id=$1`,
		`DELETE FROM core.page WHERE id=$1`,
	}
	for _, q := range statements {
		if _, err = tx.Exec(ctx, q, in.PageID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
