package editor

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	errWhiteboardDraftExpired   = errors.New("draft replay expired or unavailable")
	errWhiteboardDraftCursor    = errors.New("invalid draft cursor")
	errWhiteboardDraftIntegrity = errors.New("invalid draft replay data")
)

func draftRollback(ctx context.Context, tx pgx.Tx) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(cleanup)
}
func draftURL(in whiteboardDraftInput) string {
	return fmt.Sprintf("/api/v2/editor/space/%s/whiteboard/%d", in.SpaceID, in.PageID)
}
func draftCursor(replay whiteboardDraftReplay, after int64) string {
	data := make([]byte, 24)
	copy(data, replay.ID[:])
	binary.BigEndian.PutUint64(data[16:], uint64(after))
	mac := hmac.New(sha256.New, replay.Secret[:])
	mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(append(data, mac.Sum(nil)...))
}
func parseDraftCursor(cursor string) (uuid.UUID, int64, []byte, error) {
	data, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || len(data) != 56 || base64.RawURLEncoding.EncodeToString(data) != cursor {
		return uuid.Nil, 0, nil, errWhiteboardDraftCursor
	}
	var id uuid.UUID
	copy(id[:], data[:16])
	after := binary.BigEndian.Uint64(data[16:24])
	if id == uuid.Nil || after > math.MaxInt64 {
		return uuid.Nil, 0, nil, errWhiteboardDraftCursor
	}
	return id, int64(after), data, nil
}

func (service *whiteboardServiceV2) GetDraft(ctx context.Context, in whiteboardDraftInput) (whiteboardDraftManifest, error) {
	result := whiteboardDraftManifest{PageID: in.PageID, SpaceID: in.SpaceID}
	tx, err := service.begin(ctx)
	if err != nil {
		return result, err
	}
	defer draftRollback(ctx, tx)
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return result, err
	}
	// Lifecycle/compaction lock order matches checkpoints. Holding SHARE on the
	// draft only while creating the lease closes the capture-to-retention race.
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && deleted) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	var page int64
	err = tx.QueryRow(ctx, whiteboardV2CheckpointLockBoard, in.PageID, in.SpaceID).Scan(&page)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	snapshot := &result.BaseSnapshot
	err = tx.QueryRow(ctx, whiteboardV2DraftLock, in.PageID).Scan(&snapshot.ID, &result.HeadSequence, &result.UpdatedBy, &result.UpdatedAt, &result.RestoreGeneration)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2DraftMissing
	}
	if err != nil {
		return result, err
	}
	err = tx.QueryRow(ctx, whiteboardV2DraftSnapshot, in.PageID, snapshot.ID).Scan(&snapshot.ThroughSequence, &snapshot.Title, &snapshot.ByteLength, &snapshot.StateDigest)
	if err != nil {
		return result, err
	}
	if snapshot.ThroughSequence < 0 || result.HeadSequence < snapshot.ThroughSequence || snapshot.ByteLength <= 0 {
		return result, errWhiteboardDraftIntegrity
	}
	if err = tx.QueryRow(ctx, whiteboardV2TitleAtSequence, in.PageID, snapshot.ThroughSequence, result.HeadSequence, snapshot.Title).Scan(&result.Title); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, whiteboardV2ReplayCleanup, in.PageID); err != nil {
		return result, err
	}
	replay := whiteboardDraftReplay{ID: uuid.New(), Secret: uuid.New(), SnapshotID: snapshot.ID, Base: snapshot.ThroughSequence, Head: result.HeadSequence}
	err = tx.QueryRow(ctx, whiteboardV2ReplayInsert, replay.ID, in.PageID, in.ActorID, replay.SnapshotID, replay.Base, replay.Head, replay.Secret).Scan(&result.ExpiresAt)
	if err != nil {
		return result, err
	}
	snapshot.UpdateEncoding = whiteboardUpdateEncodingV1
	snapshot.DownloadURL = fmt.Sprintf("%s/snapshots/%s/content?replay=%s", draftURL(in), snapshot.ID, replay.ID)
	result.UpdatesURL = draftURL(in) + "/draft/updates?cursor=" + draftCursor(replay, replay.Base)
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func (service *whiteboardServiceV2) beginDraftReplay(ctx context.Context, in whiteboardDraftInput, id uuid.UUID) (pgx.Tx, whiteboardDraftReplay, error) {
	replay := whiteboardDraftReplay{ID: id}
	tx, err := service.begin(ctx)
	if err != nil {
		return nil, replay, err
	}
	fail := func(err error) (pgx.Tx, whiteboardDraftReplay, error) {
		draftRollback(ctx, tx)
		return nil, replay, err
	}
	// MVCC preserves rows for an in-flight page/download even if its lease expires
	// during transfer. A subsequent request must still have an unexpired lease.
	if _, err = tx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`); err != nil {
		return fail(err)
	}
	var page int64
	err = tx.QueryRow(ctx, whiteboardV2DraftBoard, in.PageID, in.SpaceID).Scan(&page)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	err = tx.QueryRow(ctx, whiteboardV2ReplayGet, id, in.PageID, in.ActorID).Scan(&replay.SnapshotID, &replay.Base, &replay.Head, &replay.Secret, &replay.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(errWhiteboardDraftExpired)
	}
	if err != nil {
		return fail(err)
	}
	if replay.Base < 0 || replay.Head < replay.Base {
		return fail(errWhiteboardDraftIntegrity)
	}
	return tx, replay, nil
}

func (service *whiteboardServiceV2) GetDraftUpdates(ctx context.Context, in whiteboardDraftInput, cursor string) (whiteboardDraftPage, error) {
	result := whiteboardDraftPage{Updates: []whiteboardDraftUpdate{}}
	id, after, data, err := parseDraftCursor(cursor)
	if err != nil {
		return result, err
	}
	tx, replay, err := service.beginDraftReplay(ctx, in, id)
	if err != nil {
		return result, err
	}
	defer draftRollback(ctx, tx)
	mac := hmac.New(sha256.New, replay.Secret[:])
	mac.Write(data[:24])
	if !hmac.Equal(data[24:], mac.Sum(nil)) || after < replay.Base || after > replay.Head {
		return result, errWhiteboardDraftCursor
	}
	result.HeadSequence = replay.Head
	rows, err := tx.Query(ctx, whiteboardV2DraftUpdates, in.PageID, after, replay.Head, whiteboardDraftPageCount, whiteboardDraftPageBytes, whiteboardCheckpointV2MaxUpdate)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	last, size := after, 0
	for rows.Next() {
		var update whiteboardDraftUpdate
		if err = rows.Scan(&update.Sequence, &update.UpdateEncoding, &update.Update, &update.Title); err != nil {
			return result, err
		}
		if last == math.MaxInt64 || update.Sequence != last+1 || update.Sequence > replay.Head || update.UpdateEncoding != whiteboardUpdateEncodingV1 || len(update.Update) == 0 || len(update.Update) > whiteboardCheckpointV2MaxUpdate {
			return result, errWhiteboardDraftIntegrity
		}
		size += len(update.Update)
		if size > whiteboardDraftPageBytes || len(result.Updates) >= whiteboardDraftPageCount {
			return result, errWhiteboardDraftIntegrity
		}
		result.Updates = append(result.Updates, update)
		last = update.Sequence
	}
	if err = rows.Err(); err != nil {
		return result, err
	}
	result.Complete = last == replay.Head
	if !result.Complete {
		if last == after {
			return result, errWhiteboardDraftIntegrity
		}
		next := draftCursor(replay, last)
		result.NextCursor = &next
	}
	return result, nil
}

func (service *whiteboardServiceV2) OpenDraftSnapshot(ctx context.Context, in whiteboardDraftInput, snapshotID, replayID uuid.UUID) (whiteboardSnapshotStream, error) {
	result := whiteboardSnapshotStream{}
	tx, replay, err := service.beginDraftReplay(ctx, in, replayID)
	if err != nil {
		return result, err
	}
	fail := func(err error) (whiteboardSnapshotStream, error) { draftRollback(ctx, tx); return result, err }
	if replay.SnapshotID != snapshotID {
		return fail(errWhiteboardV2BoardNotFound)
	}
	var sequence int64
	var title string
	err = tx.QueryRow(ctx, whiteboardV2DraftSnapshot, in.PageID, snapshotID).Scan(&sequence, &title, &result.Length, &result.Digest)
	if err != nil {
		return fail(err)
	}
	if sequence != replay.Base || result.Length <= 0 {
		return fail(errWhiteboardDraftIntegrity)
	}
	result.Content = &whiteboardSnapshotReader{ctx: ctx, tx: tx, page: in.PageID, snapshot: snapshotID, length: result.Length}
	return result, nil
}

// Fetch only bounded bytea slices. This abstraction can later use a storage
// object reader without changing the HTTP manifest or download contract.
type whiteboardSnapshotReader struct {
	ctx                           context.Context
	tx                            pgx.Tx
	page                          int64
	snapshot                      uuid.UUID
	length, position, bufferStart int64
	buffer                        []byte
}

func (r *whiteboardSnapshotReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.position >= r.length {
		return 0, io.EOF
	}
	if r.buffer == nil || r.position < r.bufferStart || r.position >= r.bufferStart+int64(len(r.buffer)) {
		count := min(int64(whiteboardSnapshotChunkBytes), r.length-r.position)
		var data []byte
		err := r.tx.QueryRow(r.ctx, whiteboardV2SnapshotChunk, r.page, r.snapshot, r.position+1, count).Scan(&data)
		if err != nil {
			return 0, err
		}
		if int64(len(data)) != count {
			return 0, errWhiteboardDraftIntegrity
		}
		r.buffer, r.bufferStart = data, r.position
	}
	n := copy(p, r.buffer[r.position-r.bufferStart:])
	r.position += int64(n)
	return n, nil
}
func (r *whiteboardSnapshotReader) Seek(offset int64, whence int) (int64, error) {
	var base int64
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = r.position
	case io.SeekEnd:
		base = r.length
	default:
		return 0, errors.New("invalid seek origin")
	}
	if offset < -base || offset > math.MaxInt64-base {
		return 0, errors.New("invalid seek offset")
	}
	r.position = base + offset
	return r.position, nil
}
func (r *whiteboardSnapshotReader) Close() error { draftRollback(r.ctx, r.tx); return nil }
