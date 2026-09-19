package editor

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/quota"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type whiteboardDeletionUpload struct {
	key         *string
	bytes       int64
	reservation quota.UploadReservation
	leaseUntil  *time.Time
}

type whiteboardDeletionAsset struct {
	key   string
	bytes int64
}

// Migration retains the original catalog and staging receipts. Match the legacy
// writer's object lock before reading either table: an upload already transferring
// bytes must finish (or make this deletion time out) before its receipt can vanish.
// The caller's page lock also prevents new receipts from passing their page FK.
func lockLegacyWhiteboardDeletionObjects(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput) ([]whiteboardDeletionAsset, []whiteboardDeletionUpload, error) {
	rows, err := tx.Query(ctx, `SELECT content_hash FROM core.whiteboard_asset WHERE page_id=$1
 UNION SELECT content_hash FROM core.whiteboard_asset_staging WHERE page_id=$1 ORDER BY content_hash`, in.PageID)
	if err != nil {
		return nil, nil, err
	}
	hashes, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, nil, err
	}
	for _, hash := range hashes {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, fmt.Sprintf("%d:%s", in.PageID, hash)); err != nil {
			return nil, nil, err
		}
	}
	rows, err = tx.Query(ctx, `SELECT storage_key,file_size FROM core.whiteboard_asset WHERE page_id=$1 ORDER BY content_hash FOR UPDATE`, in.PageID)
	if err != nil {
		return nil, nil, err
	}
	assets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (whiteboardDeletionAsset, error) {
		var object whiteboardDeletionAsset
		err := row.Scan(&object.key, &object.bytes)
		return object, err
	})
	if err != nil {
		return nil, nil, err
	}
	rows, err = tx.Query(ctx, `SELECT token,content_hash,storage_key,file_size,
 quota_account_id,quota_space_id,quota_reserved_bytes,quota_correlation_id
 FROM core.whiteboard_asset_staging WHERE page_id=$1 ORDER BY token FOR UPDATE`, in.PageID)
	if err != nil {
		return nil, nil, err
	}
	uploads, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (whiteboardDeletionUpload, error) {
		var object whiteboardDeletionUpload
		var token uuid.UUID
		var hash string
		var account, space *uuid.UUID
		var correlation *string
		if err := row.Scan(&token, &hash, &object.key, &object.bytes, &account, &space, &object.reservation.ReservedBytes, &correlation); err != nil {
			return object, err
		}
		if account != nil {
			object.reservation.AccountID = *account
		}
		if space != nil {
			object.reservation.SpaceID = *space
		}
		if correlation != nil {
			object.reservation.CorrelationID = *correlation
		}
		object.reservation.SourceType = "whiteboard_asset_staging"
		object.reservation.SourceID = token.String()
		object.reservation.Metadata = map[string]any{"pageId": in.PageID, "contentHash": hash}
		if object.reservation.ReservedBytes > 0 && object.reservation.SpaceID != in.SpaceID {
			return object, fmt.Errorf("legacy asset reservation belongs to another space")
		}
		return object, nil
	})
	return assets, uploads, err
}

// queueWhiteboardAssetDeletionV2 runs after the caller locks the space and
// page/board. Cleanup records deliberately outlive the rows removed below. Only
// this logical deletion releases usage; physical deletion must never charge or
// release quota again.
func queueWhiteboardAssetDeletionV2(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput) error {
	rows, err := tx.Query(ctx, `SELECT storage_key,byte_length,reservation,lease_until
 FROM whiteboard.whiteboard_asset_upload WHERE page_id=$1 ORDER BY id FOR UPDATE`, in.PageID)
	if err != nil {
		return err
	}
	uploads, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (whiteboardDeletionUpload, error) {
		var object whiteboardDeletionUpload
		var reservation []byte
		if err := row.Scan(&object.key, &object.bytes, &reservation, &object.leaseUntil); err != nil {
			return object, err
		}
		if err := json.Unmarshal(reservation, &object.reservation); err != nil {
			return object, fmt.Errorf("decode v2 asset reservation for deletion: %w", err)
		}
		if object.reservation.ReservedBytes > 0 && object.reservation.SpaceID != in.SpaceID {
			return object, fmt.Errorf("v2 asset reservation belongs to another space")
		}
		return object, nil
	})
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, `SELECT storage_key,file_size FROM whiteboard.whiteboard_asset
 WHERE page_id=$1 ORDER BY content_hash FOR UPDATE`, in.PageID)
	if err != nil {
		return err
	}
	assets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (whiteboardDeletionAsset, error) {
		var object whiteboardDeletionAsset
		err := row.Scan(&object.key, &object.bytes)
		return object, err
	})
	if err != nil {
		return err
	}
	legacyAssets, legacyUploads, err := lockLegacyWhiteboardDeletionObjects(ctx, tx, in)
	if err != nil {
		return err
	}
	assets = append(assets, legacyAssets...)
	uploads = append(uploads, legacyUploads...)
	var accountID *uuid.UUID
	if len(assets) > 0 || len(uploads) > 0 {
		if err = tx.QueryRow(ctx, `SELECT account_id FROM core.space WHERE id=$1`, in.SpaceID).Scan(&accountID); err != nil {
			return err
		}
	}
	queue := func(key string, byteCount int64, leaseUntil *time.Time) error {
		if key == "" {
			return nil
		}
		notBefore := time.Now().UTC()
		if leaseUntil != nil && leaseUntil.Add(whiteboardAssetWriteGrace).After(notBefore) {
			notBefore = leaseUntil.Add(whiteboardAssetWriteGrace)
		}
		_, err := tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_asset_cleanup
 (id,page_id,space_id,account_id,storage_key,byte_count,reason,not_before)
 VALUES($1,$2,$3,$4,$5,$6,'board_deleted',$7)
 ON CONFLICT(storage_key) DO UPDATE SET not_before=GREATEST(whiteboard.whiteboard_asset_cleanup.not_before,EXCLUDED.not_before),
 completed_at=NULL,exhausted_at=NULL,attempt_count=0,lease_id=NULL,lease_until=NULL,last_error=NULL`, uuid.New(), in.PageID, in.SpaceID, accountID, key, byteCount, notBefore)
		return err
	}
	var catalogBytes int64
	for _, asset := range assets {
		if err = queue(asset.key, asset.bytes, nil); err != nil {
			return err
		}
		catalogBytes += asset.bytes
	}
	for _, upload := range uploads {
		if upload.key != nil {
			if err = queue(*upload.key, upload.bytes, upload.leaseUntil); err != nil {
				return err
			}
		}
	}
	// Acquire quota locks only after all asset rows and cleanup intent are held.
	// Deleting the receipt in this same transaction makes reservation settlement
	// exactly once even when the caller retries after an ambiguous HTTP response.
	for _, upload := range uploads {
		if err = quota.ReleaseUploadReservationTx(ctx, tx, upload.reservation); err != nil {
			return err
		}
	}
	if err = quota.ApplyStorageUsageDeltaTx(ctx, tx, in.SpaceID, -catalogBytes, "release", "whiteboard_asset_v2_delete", strconv.FormatInt(in.PageID, 10), map[string]any{"pageId": in.PageID}); err != nil {
		return err
	}
	for _, query := range []string{
		`DELETE FROM whiteboard.whiteboard_snapshot_asset WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_snapshot_asset_manifest WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_asset_upload WHERE page_id=$1`,
		`DELETE FROM whiteboard.whiteboard_asset WHERE page_id=$1`,
		`DELETE FROM core.whiteboard_asset_staging WHERE page_id=$1`,
		`DELETE FROM core.whiteboard_asset WHERE page_id=$1`,
	} {
		if _, err = tx.Exec(ctx, query, in.PageID); err != nil {
			return err
		}
	}
	return nil
}
