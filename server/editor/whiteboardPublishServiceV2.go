package editor

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	errWhiteboardNotPublished    = errors.New("whiteboard has not been published")
	errWhiteboardPublishSequence = errors.New("sequence is outside the available draft history")
	errWhiteboardPublishState    = errors.New("draft state is incomplete or unsupported")
	errWhiteboardPublishLimit    = errors.New("publish replay exceeds 32 MiB or 10000 updates")
)

func (service *whiteboardServiceV2) PublishWhiteboard(ctx context.Context, in whiteboardPublishInput) (whiteboardPublishedManifest, error) {
	var result whiteboardPublishedManifest
	preview, err := validateWhiteboardPreview(in.PreviewPNG)
	if err != nil {
		return result, err
	}
	tx, err := service.begin(ctx)
	if err != nil {
		return result, err
	}
	defer draftRollback(ctx, tx)
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return result, err
	}
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && deleted) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	var page int64
	err = tx.QueryRow(ctx, whiteboardV2PublishLockBoard, in.PageID, in.SpaceID).Scan(&page)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	var version uuid.UUID
	var sequence int64
	var previewDigest string
	err = tx.QueryRow(ctx, whiteboardV2PublishReceipt, in.PageID, in.ActorID, in.IdempotencyKey).Scan(&version, &sequence, &previewDigest)
	if err == nil {
		if sequence != in.Sequence || previewDigest != preview.Digest {
			return result, errWhiteboardV2KeyReuse
		}
		// Never move the pointer on retry: a later publication may now be current.
		return readPublishedManifest(ctx, tx, in.whiteboardDraftInput, version)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if archived {
		return result, errWhiteboardV2Archived
	}
	var head, generation int64
	err = tx.QueryRow(ctx, whiteboardV2CheckpointLockDraft, in.PageID).Scan(&head, &generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2DraftMissing
	}
	if err != nil {
		return result, err
	}
	var restoredAt int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sequence),0) FROM whiteboard.whiteboard_restore_receipt WHERE page_id=$1`, in.PageID).Scan(&restoredAt); err != nil {
		return result, err
	}
	if in.Sequence < restoredAt || in.Sequence < 0 || in.Sequence > head {
		return result, errWhiteboardPublishSequence
	}
	var snapshot uuid.UUID
	var base int64
	var title, digest string
	var state []byte
	err = tx.QueryRow(ctx, whiteboardV2PublishBase, in.PageID, in.Sequence).Scan(&snapshot, &base, &title, &state, &digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardPublishSequence
	}
	if err != nil {
		return result, err
	}
	if base < 0 || base > in.Sequence || fmt.Sprintf("sha256:%x", sha256.Sum256(state)) != digest {
		return result, errWhiteboardPublishState
	}
	size := len(state)
	if size > whiteboardPublishMaxBytes || in.Sequence-base > 10000 {
		return result, errWhiteboardPublishLimit
	}
	updates := [][]byte{state}
	rows, err := tx.Query(ctx, whiteboardV2PublishUpdates, in.PageID, base, in.Sequence)
	if err != nil {
		return result, err
	}
	last := base
	for rows.Next() {
		var seq int64
		var encoding string
		var update []byte
		if err = rows.Scan(&seq, &encoding, &update); err != nil {
			rows.Close()
			return result, err
		}
		if seq != last+1 || encoding != whiteboardUpdateEncodingV1 || len(update) == 0 || len(update) > whiteboardCheckpointV2MaxUpdate {
			rows.Close()
			return result, errWhiteboardPublishState
		}
		size += len(update)
		if size > whiteboardPublishMaxBytes {
			rows.Close()
			return result, errWhiteboardPublishLimit
		}
		updates = append(updates, update)
		last = seq
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}
	if last != in.Sequence {
		return result, errWhiteboardPublishState
	}
	if err = tx.QueryRow(ctx, whiteboardV2TitleAtSequence, in.PageID, base, in.Sequence, title).Scan(&title); err != nil {
		return result, err
	}
	materialize := service.materialize
	if materialize == nil {
		materialize = materializeWhiteboard
	}
	full, err := materialize(ctx, updates, title)
	if err != nil {
		return result, err
	}
	if base != in.Sequence {
		snapshot = uuid.New()
		digest = fmt.Sprintf("sha256:%x", sha256.Sum256(full.State))
		if _, err = tx.Exec(ctx, whiteboardV2PublishSnapshot, snapshot, in.PageID, in.Sequence, full.Title, full.State, digest, in.ActorID); err != nil {
			return result, err
		}
	}
	version = uuid.New()
	if _, err = tx.Exec(ctx, whiteboardV2PublishVersion, version, in.PageID, snapshot, in.ActorID, in.IdempotencyKey); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, whiteboardV2InsertPreview, version, preview.Bytes, preview.Digest, preview.Width, preview.Height); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, whiteboardV2PublishPointer, in.PageID, version); err != nil {
		return result, err
	}
	result, err = readPublishedManifest(ctx, tx, in.whiteboardDraftInput, version)
	if err != nil {
		return result, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}
func readPublishedManifest(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput, version uuid.UUID) (whiteboardPublishedManifest, error) {
	result := whiteboardPublishedManifest{PageID: in.PageID, SpaceID: in.SpaceID}
	s := &result.Snapshot
	err := tx.QueryRow(ctx, whiteboardV2Published, in.PageID, version).Scan(&result.VersionID, &result.VersionNumber, &result.PublishedBy, &result.PublishedAt, &s.ID, &s.ThroughSequence, &s.Title, &s.ByteLength, &s.StateDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	preview := &whiteboardPreviewMetadata{URL: fmt.Sprintf("%s/published/%s/preview", draftURL(in), version), ContentType: "image/png"}
	err = tx.QueryRow(ctx, whiteboardV2PreviewMetadata, version).Scan(&preview.ByteLength, &preview.Digest, &preview.Width, &preview.Height)
	if err == nil {
		result.Preview = preview
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	err = nil
	s.UpdateEncoding = whiteboardUpdateEncodingV1
	s.DownloadURL = fmt.Sprintf("%s/published/%s/content", draftURL(in), version)
	return result, err
}
func (service *whiteboardServiceV2) beginPublished(ctx context.Context, in whiteboardDraftInput) (pgx.Tx, *uuid.UUID, error) {
	tx, err := service.begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	fail := func(err error) (pgx.Tx, *uuid.UUID, error) { draftRollback(ctx, tx); return nil, nil, err }
	if _, err = tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`); err != nil {
		return fail(err)
	}
	var current *uuid.UUID
	err = tx.QueryRow(ctx, whiteboardV2PublishedPointer, in.PageID, in.SpaceID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	return tx, current, nil
}
func (service *whiteboardServiceV2) GetPublishedWhiteboard(ctx context.Context, in whiteboardDraftInput) (whiteboardPublishedManifest, error) {
	tx, current, err := service.beginPublished(ctx, in)
	if err != nil {
		return whiteboardPublishedManifest{}, err
	}
	defer draftRollback(ctx, tx)
	if current == nil {
		return whiteboardPublishedManifest{}, errWhiteboardNotPublished
	}
	return readPublishedManifest(ctx, tx, in, *current)
}
func (service *whiteboardServiceV2) OpenPublishedSnapshot(ctx context.Context, in whiteboardDraftInput, version uuid.UUID) (whiteboardSnapshotStream, error) {
	tx, _, err := service.beginPublished(ctx, in)
	if err != nil {
		return whiteboardSnapshotStream{}, err
	}
	manifest, err := readPublishedManifest(ctx, tx, in, version)
	if err != nil {
		draftRollback(ctx, tx)
		return whiteboardSnapshotStream{}, err
	}
	s := manifest.Snapshot
	return whiteboardSnapshotStream{Length: s.ByteLength, Digest: s.StateDigest, Content: &whiteboardSnapshotReader{ctx: ctx, tx: tx, page: in.PageID, snapshot: s.ID, length: s.ByteLength}}, nil
}
