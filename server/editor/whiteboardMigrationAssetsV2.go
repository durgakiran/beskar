package editor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"time"

	"github.com/durgakiran/beskar/quota"
	"github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const whiteboardMigrationAssetCopyTimeout = 2 * time.Minute

var errWhiteboardMigrationAssetMismatch = errors.New("The migrated image manifest does not match the legacy whiteboard.")

type whiteboardMigrationAssetCopy struct {
	Asset          whiteboardSnapshotAsset
	SourceKey, Key string
}

func migrationAssetManifest(inspection whiteboardMigrationInspection) whiteboardMaterialized {
	return whiteboardMaterialized{Assets: inspection.Assets, AssetExtractorVersion: inspection.AssetExtractorVersion}
}

func validateMigrationAssetManifests(source, submitted whiteboardMigrationInspection) error {
	if validateWhiteboardMigrationInspection(source) != nil || validateWhiteboardMigrationInspection(submitted) != nil {
		return errWhiteboardMigrationFormat
	}
	if !slices.Equal(source.Assets, submitted.Assets) || !slices.Equal(source.AssetIDs, submitted.AssetIDs) {
		return errWhiteboardMigrationAssetMismatch
	}
	return nil
}

// Only committed assets belonging to this page are eligible. URLs in Yjs records
// never select an object; original catalog metadata must match the inspected state.
func readMigrationAssetCatalog(ctx context.Context, tx pgx.Tx, page int64, assets []whiteboardSnapshotAsset) ([]whiteboardMigrationAssetCopy, error) {
	if len(assets) == 0 {
		return nil, nil
	}
	hashes := make([]string, len(assets))
	for i, asset := range assets {
		hashes[i] = asset.ContentHash
	}
	rows, err := tx.Query(ctx, `SELECT content_hash,mime_type,file_size,width,height,storage_key FROM core.whiteboard_asset
        WHERE page_id=$1 AND content_hash=ANY($2::text[]) ORDER BY content_hash FOR SHARE`, page, hashes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	copies := make([]whiteboardMigrationAssetCopy, 0, len(assets))
	for rows.Next() {
		var copy whiteboardMigrationAssetCopy
		if err = rows.Scan(&copy.Asset.ContentHash, &copy.Asset.MimeType, &copy.Asset.ByteLength, &copy.Asset.Width, &copy.Asset.Height, &copy.SourceKey); err != nil {
			return nil, err
		}
		if len(copies) >= len(assets) || copy.Asset != assets[len(copies)] || copy.SourceKey == "" {
			return nil, errWhiteboardMigrationAssetMismatch
		}
		copies = append(copies, copy)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(copies) != len(assets) {
		return nil, errWhiteboardAssetNotFound
	}
	return copies, nil
}

func migrationAssetBytes(copies []whiteboardMigrationAssetCopy) int64 {
	var total int64
	for _, copy := range copies {
		total += copy.Asset.ByteLength
	}
	return total
}

func reserveMigrationAssets(ctx context.Context, tx pgx.Tx, in whiteboardMigrationInput, copies []whiteboardMigrationAssetCopy) (quota.UploadReservation, error) {
	return quota.ReserveUploadCapacityTx(ctx, tx, in.PageID, migrationAssetBytes(copies), "whiteboard_migration_v2", in.IdempotencyKey.String(), map[string]any{"pageId": in.PageID})
}

func (s *whiteboardServiceV2) copyMigrationAssets(ctx context.Context, in whiteboardMigrationInput, assets []whiteboardSnapshotAsset) ([]whiteboardMigrationAssetCopy, error) {
	if len(assets) == 0 {
		return nil, nil
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		draftRollback(ctx, tx)
		return nil, err
	}
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && deleted {
		err = errWhiteboardV2BoardNotFound
	}
	if err == nil && archived {
		err = errWhiteboardV2Archived
	}
	if err != nil {
		draftRollback(ctx, tx)
		return nil, err
	}
	var page int64
	err = tx.QueryRow(ctx, `SELECT id FROM core.page WHERE id=$1 AND space_id=$2 FOR UPDATE`, in.PageID, in.SpaceID).Scan(&page)
	if errors.Is(err, pgx.ErrNoRows) {
		err = errWhiteboardV2BoardNotFound
	}
	if err != nil {
		draftRollback(ctx, tx)
		return nil, err
	}
	var exists bool
	err = tx.QueryRow(ctx, migrationExistsSQL, in.PageID, in.SpaceID).Scan(&exists)
	if err == nil && exists {
		err = errWhiteboardMigrated
	}
	if err != nil {
		draftRollback(ctx, tx)
		return nil, err
	}
	copies, err := readMigrationAssetCatalog(ctx, tx, in.PageID, assets)
	if err == nil {
		_, err = reserveMigrationAssets(ctx, tx, in, copies)
	}
	// Probe quota before expensive I/O. Actual accounting is reserved and settled
	// in the cutover transaction; no persistent reservation can leak on a crash.
	draftRollback(ctx, tx)
	if err != nil {
		return nil, err
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		return nil, errors.New("migration copy deadline required")
	}
	intent, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer draftRollback(ctx, intent)
	for i := range copies {
		copies[i].Key = fmt.Sprintf("whiteboard-v2-assets/%d/migration/%s", in.PageID, uuid.New())
		if _, err = intent.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset_cleanup(id,page_id,space_id,storage_key,byte_count,reason,not_before)
            VALUES($1,$2,$3,$4,$5,'migration-copy',$6)`, uuid.New(), in.PageID, in.SpaceID, copies[i].Key, copies[i].Asset.ByteLength, deadline.Add(whiteboardAssetWriteGrace)); err != nil {
			return nil, err
		}
	}
	if err = intent.Commit(ctx); err != nil {
		return nil, err
	}
	getStore := s.migrationStore
	if getStore == nil {
		getStore = storage.RuntimeStore
	}
	store, err := getStore(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, err)
	}
	for _, copy := range copies {
		if err = s.copyMigrationAsset(ctx, store, in, copy); err != nil {
			return nil, err
		}
	}
	return copies, nil
}

func (s *whiteboardServiceV2) copyMigrationAsset(ctx context.Context, store storage.Store, in whiteboardMigrationInput, copy whiteboardMigrationAssetCopy) error {
	readCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	body, metadata, err := store.Get(readCtx, copy.SourceKey)
	if err != nil {
		cancel()
		return fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, err)
	}
	stopClose := context.AfterFunc(readCtx, func() { _ = body.Close() })
	data, readErr := io.ReadAll(io.LimitReader(body, whiteboardAssetMaxBytes+1))
	_ = body.Close()
	stopClose()
	if readErr == nil {
		readErr = readCtx.Err()
	}
	cancel()
	if readErr != nil {
		return fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, readErr)
	}
	if metadata.Size != copy.Asset.ByteLength || int64(len(data)) != copy.Asset.ByteLength {
		return errWhiteboardMigrationAssetMismatch
	}
	actual, err := inspectWhiteboardAssetV2(ctx, data, copy.Asset.MimeType)
	if err != nil {
		return err
	}
	if actual.ContentHash != copy.Asset.ContentHash || actual.ByteLength != copy.Asset.ByteLength || actual.Width != copy.Asset.Width || actual.Height != copy.Asset.Height {
		return errWhiteboardMigrationAssetMismatch
	}
	writeCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	err = store.Put(writeCtx, copy.Key, bytes.NewReader(data), int64(len(data)), actual.ContentType)
	if err == nil {
		err = writeCtx.Err()
	}
	cancel()
	if err != nil {
		// A non-cooperative store can finish after its cleanup deadline. Reopen
		// the exact orphan's durable job so an earlier delete cannot lose it.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cleanupCancel()
		service := whiteboardAssetServiceV2{begin: s.begin}
		if cleanupErr := service.rearmFailedAssetWrite(cleanupCtx, in.whiteboardDraftInput, copy.Key, int64(len(data))); cleanupErr != nil {
			return fmt.Errorf("%w: %v; cleanup: %w", errWhiteboardAssetUnavailable, err, cleanupErr)
		}
		return fmt.Errorf("%w: %w", errWhiteboardAssetUnavailable, err)
	}
	return nil
}

// Lock intents before catalog ownership changes. A cleanup worker claims outside
// its physical DELETE transaction, so any previous claim permanently disqualifies
// this key from cutover, even if that worker later reports a successful deletion.
func lockMigrationAssetCopies(ctx context.Context, tx pgx.Tx, in whiteboardMigrationInput, copies []whiteboardMigrationAssetCopy) error {
	expected := make([]whiteboardSnapshotAsset, len(copies))
	for i, copy := range copies {
		expected[i] = copy.Asset
	}
	current, err := readMigrationAssetCatalog(ctx, tx, in.PageID, expected)
	if err != nil {
		return err
	}
	for i, copy := range copies {
		if current[i].SourceKey != copy.SourceKey {
			return errWhiteboardMigrationAssetMismatch
		}
		var safe bool
		err = tx.QueryRow(ctx, `SELECT lease_id IS NULL AND attempt_count=0 AND completed_at IS NULL AND exhausted_at IS NULL AND not_before>now()
            FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1 AND page_id=$2 AND space_id=$3 FOR UPDATE`, copy.Key, in.PageID, in.SpaceID).Scan(&safe)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !safe {
			return errWhiteboardAssetBusy
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func insertMigrationAssets(ctx context.Context, tx pgx.Tx, in whiteboardMigrationInput, copies []whiteboardMigrationAssetCopy) error {
	reservation, err := reserveMigrationAssets(ctx, tx, in, copies)
	if err != nil {
		return err
	}
	if len(copies) > 0 {
		hashes := make([]string, len(copies))
		for i, copy := range copies {
			hashes[i] = copy.Asset.ContentHash
		}
		// Retained v1 history also needs a reference, even when its last client
		// upload never registered one. The catalog SHARE locks held by cutover
		// serialize this pin with late v1 rollback/cancellation's reference check.
		tag, pinErr := tx.Exec(ctx, `INSERT INTO core.asset_reference
		 (asset_type,asset_id,page_id,doc_id,source_kind,source_id,last_seen_at,created_at,updated_at)
		 SELECT 'whiteboard_asset',asset.hash,d.page_id,d.doc_id,CASE WHEN d.draft=1 THEN 'draft_doc' ELSE 'published_doc' END,d.doc_id::text,now(),now(),now()
		 FROM core.page_doc_map d CROSS JOIN unnest($3::text[]) AS asset(hash) WHERE d.page_id=$1 AND d.doc_id=$2
		 ON CONFLICT(asset_type,asset_id,source_kind,source_id) DO UPDATE SET last_seen_at=now(),updated_at=now()`, in.PageID, in.SourceDocID, hashes)
		if pinErr != nil {
			return pinErr
		}
		if tag.RowsAffected() != int64(len(copies)) {
			return errWhiteboardMigrationSource
		}
	}
	for _, copy := range copies {
		asset := copy.Asset
		if _, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset(page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,provenance,inspector_version)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{"source":"whiteboard-migration-v1"}',$9)`, in.PageID, asset.ContentHash, copy.Key, asset.ByteLength, asset.MimeType, asset.Width, asset.Height, in.ActorID, whiteboardAssetInspectorVersion); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM whiteboard.whiteboard_asset_cleanup WHERE storage_key=$1`, copy.Key); err != nil {
			return err
		}
	}
	return quota.CommitUploadUsageTx(ctx, tx, reservation)
}
