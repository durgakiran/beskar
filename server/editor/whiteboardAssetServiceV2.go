package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/durgakiran/beskar/quota"
	"github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type whiteboardAssetServiceV2 struct {
	begin func(context.Context) (pgx.Tx, error)
	store func(context.Context) (storage.Store, error)
}

func newWhiteboardAssetServiceV2() *whiteboardAssetServiceV2 {
	return &whiteboardAssetServiceV2{begin: beginWhiteboardV2Transaction, store: storage.RuntimeStore}
}

type whiteboardAssetUploadRow struct {
	ID                              uuid.UUID
	ActorID                         uuid.UUID
	PageID                          int64
	RequestHash, Hash, ContentType  string
	ByteLength                      int64
	State, StorageKey               string
	Width, Height, InspectorVersion int
	LeaseID                         *uuid.UUID
	LeaseUntil                      *time.Time
	Reservation                     quota.UploadReservation
	ExpiresAt                       time.Time
}

const whiteboardAssetUploadColumns = `id,actor_id,page_id,request_hash,expected_hash,content_type,byte_length,state,COALESCE(storage_key,''),COALESCE(width,0),COALESCE(height,0),COALESCE(inspector_version,0),lease_id,lease_until,reservation,expires_at`

func scanWhiteboardAssetUpload(row pgx.Row) (whiteboardAssetUploadRow, error) {
	var out whiteboardAssetUploadRow
	var reservation []byte
	err := row.Scan(&out.ID, &out.ActorID, &out.PageID, &out.RequestHash, &out.Hash, &out.ContentType, &out.ByteLength, &out.State, &out.StorageKey, &out.Width, &out.Height, &out.InspectorVersion, &out.LeaseID, &out.LeaseUntil, &reservation, &out.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, errWhiteboardAssetNotFound
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(reservation, &out.Reservation); err != nil {
		return out, err
	}
	return out, nil
}

func loadWhiteboardAssetUpload(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadRow, error) {
	return scanWhiteboardAssetUpload(tx.QueryRow(ctx, `SELECT `+whiteboardAssetUploadColumns+` FROM whiteboard.whiteboard_asset_upload WHERE id=$1 AND page_id=$2 AND actor_id=$3 FOR UPDATE`, id, in.PageID, in.ActorID))
}

func whiteboardAssetBaseURL(in whiteboardDraftInput) string {
	return fmt.Sprintf("/api/v2/editor/space/%s/whiteboard/%d", in.SpaceID, in.PageID)
}

func (row whiteboardAssetUploadRow) result(in whiteboardDraftInput) whiteboardAssetUploadResult {
	base := whiteboardAssetBaseURL(in)
	status := fmt.Sprintf("%s/assets/uploads/%s", base, row.ID)
	out := whiteboardAssetUploadResult{UploadID: row.ID, State: row.State, ExpiresAt: row.ExpiresAt, UploadURL: status + "/content", StatusURL: status, CommitURL: status + "/commit"}
	if row.State == "committed" {
		out.Asset = &whiteboardAssetDescriptor{ID: "asset:sha256:" + row.Hash, PageID: in.PageID, ContentHash: row.Hash, ContentType: row.ContentType, ByteLength: row.ByteLength, Width: row.Width, Height: row.Height, DownloadURL: base + "/assets/" + row.Hash + "/content"}
	}
	return out
}

// All lifecycle mutations lock space -> page/board -> upload/catalog -> quota.
// This transaction is always closed before file transfer, decoding, or blob I/O.
func (s *whiteboardAssetServiceV2) beginAsset(ctx context.Context, in whiteboardDraftInput, allowDeleted bool) (pgx.Tx, bool, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, false, err
	}
	fail := func(err error) (pgx.Tx, bool, error) { draftRollback(ctx, tx); return nil, false, err }
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return fail(err)
	}
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && deleted && !allowDeleted) {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	var id int64
	if err = tx.QueryRow(ctx, whiteboardV2PublishLockBoard, in.PageID, in.SpaceID).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return fail(errWhiteboardV2BoardNotFound)
	}
	if err != nil {
		return fail(err)
	}
	return tx, archived, nil
}

func assetUploadTerminal(state string) bool {
	return state == "committed" || state == "cancelled" || state == "expired"
}

func queueWhiteboardUploadObject(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput, row whiteboardAssetUploadRow, reason string) error {
	if row.StorageKey == "" {
		return nil
	}
	notBefore := time.Now().UTC()
	if row.LeaseUntil != nil && row.LeaseUntil.Add(whiteboardAssetWriteGrace).After(notBefore) {
		notBefore = row.LeaseUntil.Add(whiteboardAssetWriteGrace)
	}
	var account any
	if row.Reservation.AccountID != uuid.Nil {
		account = row.Reservation.AccountID
	}
	_, err := tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,account_id,storage_key,byte_count,reason,not_before)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(storage_key) DO UPDATE SET not_before=GREATEST(whiteboard.whiteboard_asset_cleanup.not_before,EXCLUDED.not_before)`, uuid.New(), in.PageID, in.SpaceID, account, row.StorageKey, row.ByteLength, reason, notBefore)
	return err
}

func terminateWhiteboardUpload(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput, row *whiteboardAssetUploadRow, state string) error {
	if assetUploadTerminal(row.State) {
		return nil
	}
	if err := queueWhiteboardUploadObject(ctx, tx, in, *row, state); err != nil {
		return err
	}
	if err := quota.ReleaseUploadReservationTx(ctx, tx, row.Reservation); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state=$2,reservation='{}',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, row.ID, state)
	if err == nil {
		row.State = state
		row.Reservation = quota.UploadReservation{}
		row.LeaseID = nil
		row.LeaseUntil = nil
	}
	return err
}

func expireWhiteboardUpload(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput, row *whiteboardAssetUploadRow) error {
	if !assetUploadTerminal(row.State) && !time.Now().Before(row.ExpiresAt) {
		return terminateWhiteboardUpload(ctx, tx, in, row, "expired")
	}
	return nil
}

func (s *whiteboardAssetServiceV2) PrepareAsset(ctx context.Context, in whiteboardAssetPrepareInput) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	if !validWhiteboardAssetHash(in.ContentHash) || in.ByteLength <= 0 || in.IdempotencyKey == uuid.Nil {
		return out, errWhiteboardAssetInvalid
	}
	if !whiteboardAssetSupportedType(in.ContentType) {
		return out, errWhiteboardAssetUnsupported
	}
	if in.ByteLength > whiteboardAssetMaxBytes {
		return out, errWhiteboardAssetTooLarge
	}
	payload, _ := json.Marshal(struct {
		Hash, Type string
		Length     int64
	}{in.ContentHash, in.ContentType, in.ByteLength})
	requestHash := fmt.Sprintf("sha256:%x", sha256.Sum256(payload))
	tx, archived, err := s.beginAsset(ctx, in.whiteboardDraftInput, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := scanWhiteboardAssetUpload(tx.QueryRow(ctx, `SELECT `+whiteboardAssetUploadColumns+` FROM whiteboard.whiteboard_asset_upload WHERE page_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE`, in.PageID, in.ActorID, in.IdempotencyKey))
	if err == nil {
		if row.RequestHash != requestHash {
			return out, errWhiteboardV2KeyReuse
		}
		if archived && row.State != "committed" {
			return out, errWhiteboardV2Archived
		}
		if err = expireWhiteboardUpload(ctx, tx, in.whiteboardDraftInput, &row); err != nil {
			return out, err
		}
		return row.result(in.whiteboardDraftInput), tx.Commit(ctx)
	}
	if !errors.Is(err, errWhiteboardAssetNotFound) {
		return out, err
	}
	if archived {
		return out, errWhiteboardV2Archived
	}
	var active int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM whiteboard.whiteboard_asset_upload WHERE page_id=$1 AND state IN ('prepared','staging','staged')`, in.PageID).Scan(&active); err != nil {
		return out, err
	}
	if active >= 100 {
		return out, errWhiteboardAssetBusy
	}
	id := uuid.New()
	reservation, err := quota.ReserveUploadCapacityTx(ctx, tx, in.PageID, in.ByteLength, "whiteboard_asset_v2", id.String(), map[string]any{"contentHash": in.ContentHash, "actorId": in.ActorID.String()})
	if err != nil {
		return out, err
	}
	reservationJSON, err := json.Marshal(reservation)
	if err != nil {
		return out, err
	}
	row, err = scanWhiteboardAssetUpload(tx.QueryRow(ctx, `INSERT INTO whiteboard.whiteboard_asset_upload(id,page_id,actor_id,idempotency_key,request_hash,expected_hash,content_type,byte_length,reservation,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '30 minutes') RETURNING `+whiteboardAssetUploadColumns, id, in.PageID, in.ActorID, in.IdempotencyKey, requestHash, in.ContentHash, in.ContentType, in.ByteLength, reservationJSON))
	if err != nil {
		return out, err
	}
	return row.result(in.whiteboardDraftInput), tx.Commit(ctx)
}

func (s *whiteboardAssetServiceV2) StageAsset(ctx context.Context, in whiteboardDraftInput, id uuid.UUID, contentType string, data []byte) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	if len(data) > whiteboardAssetMaxBytes {
		return out, errWhiteboardAssetTooLarge
	}
	if len(data) == 0 {
		return out, errWhiteboardAssetInvalid
	}
	if !whiteboardAssetSupportedType(contentType) {
		return out, errWhiteboardAssetUnsupported
	}
	// Authenticate the session and immutable byte identity before expensive image
	// decoding. Recheck the same locked session after decoding, before claiming I/O.
	out, done, err := s.preflightAssetStage(ctx, in, id, contentType, int64(len(data)), fmt.Sprintf("%x", sha256.Sum256(data)))
	if err != nil || done {
		return out, err
	}
	inspected, err := inspectWhiteboardAssetV2(ctx, data, contentType)
	if err != nil {
		return out, err
	}
	tx, archived, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, err
	}
	if inspected.ContentHash != row.Hash || inspected.ContentType != row.ContentType || inspected.ByteLength != row.ByteLength {
		return out, errWhiteboardAssetInvalid
	}
	if row.State == "committed" {
		return row.result(in), tx.Commit(ctx)
	}
	if archived {
		return out, errWhiteboardV2Archived
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, err
	}
	if row.State == "expired" {
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardAssetExpired
	}
	if row.State == "cancelled" {
		return out, errWhiteboardAssetConflict
	}
	if row.State == "staged" {
		return row.result(in), tx.Commit(ctx)
	}
	if row.State == "staging" && row.LeaseUntil != nil && row.LeaseUntil.After(time.Now()) {
		return out, errWhiteboardAssetBusy
	}
	if err = queueWhiteboardUploadObject(ctx, tx, in, row, "abandoned-stage"); err != nil {
		return out, err
	}
	lease := uuid.New()
	key := fmt.Sprintf("whiteboard-v2-assets/%d/uploads/%s/%s", in.PageID, id, lease)
	if _, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='staging',storage_key=$2,lease_id=$3,lease_until=now()+interval '3 minutes',updated_at=now() WHERE id=$1`, id, key, lease); err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	// The key and lease are durable before the write. Every retry gets a new key.
	writeCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	store, writeErr := s.store(writeCtx)
	if writeErr == nil {
		writeErr = store.Put(writeCtx, key, bytes.NewReader(data), int64(len(data)), contentType)
	}
	cancel()
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finishCancel()
	out, err = s.finishStage(finishCtx, in, id, lease, inspected, writeErr == nil)
	if err != nil {
		// A store may finish after its context/lease was cancelled. Cleanup could
		// already have deleted this generation, so explicitly rearm its durable
		// job after the writer returns, including after owner rows were deleted.
		reconcileCtx, reconcileCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer reconcileCancel()
		if cleanupErr := s.rearmFailedAssetWrite(reconcileCtx, in, key, int64(len(data))); cleanupErr != nil {
			logWhiteboardV2Error("whiteboard v2 late asset write cleanup could not be confirmed", cleanupErr)
			return out, errors.Join(err, cleanupErr)
		}
		return out, err
	}
	if writeErr != nil {
		return out, fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, writeErr)
	}
	return out, nil
}

func (s *whiteboardAssetServiceV2) rearmFailedAssetWrite(ctx context.Context, in whiteboardDraftInput, key string, length int64) error {
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer draftRollback(ctx, tx)
	// Invalidate an older cleanup claim too: its DELETE may have happened before
	// this late PUT, while its completion acknowledgement is still in flight.
	_, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,storage_key,byte_count,reason,not_before)
		SELECT $1,$2,$3,$4,$5,'late-write',now()+interval '1 minute'
		WHERE NOT EXISTS(SELECT 1 FROM whiteboard.whiteboard_asset WHERE storage_key=$4)
		AND NOT EXISTS(SELECT 1 FROM whiteboard.whiteboard_asset_upload WHERE storage_key=$4 AND state IN ('staging','staged'))
		ON CONFLICT(storage_key) DO UPDATE SET completed_at=NULL,exhausted_at=NULL,attempt_count=0,lease_id=NULL,lease_until=NULL,
		last_error=NULL,not_before=GREATEST(whiteboard.whiteboard_asset_cleanup.not_before,EXCLUDED.not_before)`, uuid.New(), in.PageID, in.SpaceID, key, length)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *whiteboardAssetServiceV2) preflightAssetStage(ctx context.Context, in whiteboardDraftInput, id uuid.UUID, contentType string, length int64, hash string) (whiteboardAssetUploadResult, bool, error) {
	var out whiteboardAssetUploadResult
	tx, archived, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, false, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, false, err
	}
	if row.ContentType != contentType || row.ByteLength != length || row.Hash != hash {
		return out, false, errWhiteboardAssetInvalid
	}
	if row.State == "committed" {
		return row.result(in), true, tx.Commit(ctx)
	}
	if archived {
		return out, false, errWhiteboardV2Archived
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, false, err
	}
	if row.State == "expired" {
		if err = tx.Commit(ctx); err != nil {
			return out, false, err
		}
		return out, false, errWhiteboardAssetExpired
	}
	if row.State == "cancelled" {
		return out, false, errWhiteboardAssetConflict
	}
	if row.State == "staging" && row.LeaseUntil != nil && row.LeaseUntil.After(time.Now()) {
		return out, false, errWhiteboardAssetBusy
	}
	return row.result(in), row.State == "staged", tx.Commit(ctx)
}

func (s *whiteboardAssetServiceV2) finishStage(ctx context.Context, in whiteboardDraftInput, id, lease uuid.UUID, inspected whiteboardAssetDescriptor, success bool) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	tx, archived, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, err
	}
	if row.State != "staging" || row.LeaseID == nil || *row.LeaseID != lease {
		return out, errWhiteboardAssetConflict
	}
	if row.LeaseUntil == nil || !row.LeaseUntil.After(time.Now()) {
		if err = queueWhiteboardUploadObject(ctx, tx, in, row, "expired-write-lease"); err != nil {
			return out, err
		}
		if _, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='prepared',storage_key=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, id); err != nil {
			return out, err
		}
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardAssetBusy
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, err
	}
	if row.State == "expired" {
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardAssetExpired
	}
	if archived {
		if err = terminateWhiteboardUpload(ctx, tx, in, &row, "cancelled"); err != nil {
			return out, err
		}
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardV2Archived
	}
	if !success {
		if err = queueWhiteboardUploadObject(ctx, tx, in, row, "failed-stage"); err != nil {
			return out, err
		}
		_, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='prepared',storage_key=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, id)
		row.State = "prepared"
	} else {
		_, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='staged',width=$2,height=$3,inspector_version=$4,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, id, inspected.Width, inspected.Height, whiteboardAssetInspectorVersion)
		row.State = "staged"
		row.Width = inspected.Width
		row.Height = inspected.Height
	}
	if err != nil {
		return out, err
	}
	return row.result(in), tx.Commit(ctx)
}

type whiteboardAssetCatalogRow struct {
	Key, ContentType string
	Length           int64
	Width, Height    int
}

func readWhiteboardAssetCatalog(ctx context.Context, tx pgx.Tx, page int64, hash string) (whiteboardAssetCatalogRow, error) {
	var row whiteboardAssetCatalogRow
	err := tx.QueryRow(ctx, `SELECT storage_key,mime_type,file_size,width,height FROM whiteboard.whiteboard_asset WHERE page_id=$1 AND content_hash=$2`, page, hash).Scan(&row.Key, &row.ContentType, &row.Length, &row.Width, &row.Height)
	return row, err
}

func (s *whiteboardAssetServiceV2) CommitAsset(ctx context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	tx, archived, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, err
	}
	if row.State == "committed" {
		return row.result(in), tx.Commit(ctx)
	}
	if archived {
		return out, errWhiteboardV2Archived
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, err
	}
	if row.State == "expired" {
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardAssetExpired
	}
	if row.State == "cancelled" {
		return out, errWhiteboardAssetConflict
	}
	if row.State != "staged" {
		return out, errWhiteboardAssetNotReady
	}
	catalog, err := readWhiteboardAssetCatalog(ctx, tx, in.PageID, row.Hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	checkedKey := row.StorageKey
	if err == nil {
		checkedKey = catalog.Key
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	readCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	defer cancel()
	store, err := s.store(readCtx)
	if err != nil {
		return out, fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, err)
	}
	exists, err := store.Exists(readCtx, checkedKey)
	if err != nil || !exists {
		return out, errWhiteboardAssetUnavailable
	}
	return s.finalizeAssetCommit(ctx, in, id, row.StorageKey, checkedKey)
}

func (s *whiteboardAssetServiceV2) finalizeAssetCommit(ctx context.Context, in whiteboardDraftInput, id uuid.UUID, stagedKey, checkedKey string) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	tx, archived, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, err
	}
	if row.State == "committed" {
		return row.result(in), tx.Commit(ctx)
	}
	if archived {
		return out, errWhiteboardV2Archived
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, err
	}
	if row.State == "expired" {
		if err = tx.Commit(ctx); err != nil {
			return out, err
		}
		return out, errWhiteboardAssetExpired
	}
	if row.State != "staged" || row.StorageKey != stagedKey {
		return out, errWhiteboardAssetConflict
	}
	catalog, err := readWhiteboardAssetCatalog(ctx, tx, in.PageID, row.Hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	created := errors.Is(err, pgx.ErrNoRows)
	if created {
		if checkedKey != row.StorageKey {
			return out, errWhiteboardAssetBusy
		}
		_, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset(page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,provenance,inspector_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{"source":"whiteboard-upload-v2"}',$9)`, in.PageID, row.Hash, row.StorageKey, row.ByteLength, row.ContentType, row.Width, row.Height, in.ActorID, row.InspectorVersion)
		if err != nil {
			return out, err
		}
		if err = quota.CommitUploadUsageTx(ctx, tx, row.Reservation); err != nil {
			return out, err
		}
	} else {
		if catalog.Key != checkedKey {
			return out, errWhiteboardAssetBusy
		}
		if catalog.ContentType != row.ContentType || catalog.Length != row.ByteLength || catalog.Width != row.Width || catalog.Height != row.Height {
			return out, errWhiteboardAssetInvalid
		}
		if err = quota.ReleaseUploadReservationTx(ctx, tx, row.Reservation); err != nil {
			return out, err
		}
		if row.StorageKey != catalog.Key {
			if err = queueWhiteboardUploadObject(ctx, tx, in, row, "duplicate-upload"); err != nil {
				return out, err
			}
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='committed',reservation='{}',updated_at=now() WHERE id=$1`, id); err != nil {
		return out, err
	}
	row.State = "committed"
	return row.result(in), tx.Commit(ctx)
}

func (s *whiteboardAssetServiceV2) GetAssetUpload(ctx context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	return s.assetUploadStatus(ctx, in, id, false)
}
func (s *whiteboardAssetServiceV2) CancelAsset(ctx context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	return s.assetUploadStatus(ctx, in, id, true)
}
func (s *whiteboardAssetServiceV2) assetUploadStatus(ctx context.Context, in whiteboardDraftInput, id uuid.UUID, cancel bool) (whiteboardAssetUploadResult, error) {
	var out whiteboardAssetUploadResult
	tx, _, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return out, err
	}
	if err = expireWhiteboardUpload(ctx, tx, in, &row); err != nil {
		return out, err
	}
	if cancel {
		if err = terminateWhiteboardUpload(ctx, tx, in, &row, "cancelled"); err != nil {
			return out, err
		}
	}
	out = row.result(in)
	out.Retained = cancel && row.State == "committed"
	if row.State == "cancelled" || row.State == "expired" {
		prefix := fmt.Sprintf("whiteboard-v2-assets/%d/uploads/%s/%%", in.PageID, id)
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key LIKE $1 AND completed_at IS NULL)`, prefix).Scan(&out.CleanupPending); err != nil {
			return out, err
		}
	}
	return out, tx.Commit(ctx)
}

type whiteboardAssetMemoryContent struct{ *bytes.Reader }

func (whiteboardAssetMemoryContent) Close() error { return nil }

func (s *whiteboardAssetServiceV2) OpenAsset(ctx context.Context, in whiteboardDraftInput, hash string, version *uuid.UUID) (whiteboardAssetContent, error) {
	var out whiteboardAssetContent
	if !validWhiteboardAssetHash(hash) {
		return out, errWhiteboardAssetInvalid
	}
	tx, _, err := s.beginAsset(ctx, in, false)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	if version != nil {
		var allowed bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM whiteboard.whiteboard_version v
            JOIN whiteboard.whiteboard_snapshot s ON s.page_id=v.page_id AND s.id=v.snapshot_id
            JOIN whiteboard.whiteboard_snapshot_asset_manifest m ON m.page_id=s.page_id AND m.snapshot_id=s.id AND m.state_digest=s.state_digest AND m.extractor_version=$4
            JOIN whiteboard.whiteboard_snapshot_asset a ON a.page_id=s.page_id AND a.snapshot_id=s.id
            WHERE v.page_id=$1 AND v.id=$2 AND a.content_hash=$3)`, in.PageID, *version, hash, whiteboardAssetExtractorVersion).Scan(&allowed)
		if err != nil {
			return out, err
		}
		if !allowed {
			return out, errWhiteboardAssetNotFound
		}
	}
	catalog, err := readWhiteboardAssetCatalog(ctx, tx, in.PageID, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, errWhiteboardAssetNotFound
	}
	if err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	readCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	defer cancel()
	store, err := s.store(readCtx)
	if err != nil {
		return out, errWhiteboardAssetUnavailable
	}
	body, meta, err := store.Get(readCtx, catalog.Key)
	if err != nil {
		return out, errWhiteboardAssetUnavailable
	}
	defer body.Close()
	if meta.Size != catalog.Length || catalog.Length > whiteboardAssetMaxBytes {
		return out, errWhiteboardAssetUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(body, catalog.Length+1))
	if err != nil || int64(len(data)) != catalog.Length || fmt.Sprintf("%x", sha256.Sum256(data)) != hash {
		return out, errWhiteboardAssetUnavailable
	}
	return whiteboardAssetContent{Content: whiteboardAssetMemoryContent{bytes.NewReader(data)}, Length: catalog.Length, Digest: hash, ContentType: catalog.ContentType}, nil
}
