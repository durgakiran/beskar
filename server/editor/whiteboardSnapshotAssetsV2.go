package editor

import (
	"context"
	"errors"
	"regexp"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const whiteboardAssetExtractorVersion = "glideboard-assets-v1"

var (
	errWhiteboardSnapshotAssetInvalid  = errors.New("snapshot contains invalid or unsupported asset references")
	errWhiteboardSnapshotAssetNotReady = errors.New("snapshot references an asset that is not committed to this whiteboard")
	whiteboardSnapshotAssetHash        = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

func validateWhiteboardSnapshotAssets(full whiteboardMaterialized) error {
	if full.AssetExtractorVersion != whiteboardAssetExtractorVersion || full.Assets == nil || len(full.Assets) > 10000 {
		return errWhiteboardSnapshotAssetInvalid
	}
	last := ""
	for _, asset := range full.Assets {
		if !whiteboardSnapshotAssetHash.MatchString(asset.ContentHash) || asset.ContentHash <= last ||
			(asset.MimeType != "image/png" && asset.MimeType != "image/jpeg" && asset.MimeType != "image/webp") ||
			asset.ByteLength <= 0 || asset.ByteLength > 20*1024*1024 ||
			asset.Width <= 0 || asset.Width > 16384 || asset.Height <= 0 || asset.Height > 16384 ||
			int64(asset.Width)*int64(asset.Height) > 64000000 {
			return errWhiteboardSnapshotAssetInvalid
		}
		last = asset.ContentHash
	}
	return nil
}

// The caller holds the board write lock through commit. Catalog content is
// immutable; SHARE also keeps matching rows stable while associations are built.
// Inspection must precede this helper, even for snapshots predating the manifest.
func associateWhiteboardSnapshotAssets(ctx context.Context, tx pgx.Tx, page int64, snapshot uuid.UUID, digest string, full whiteboardMaterialized) error {
	if err := validateWhiteboardSnapshotAssets(full); err != nil {
		return err
	}
	hashes := make([]string, len(full.Assets))
	expected := make(map[string]whiteboardSnapshotAsset, len(full.Assets))
	for i, asset := range full.Assets {
		hashes[i] = asset.ContentHash
		expected[asset.ContentHash] = asset
	}
	rows, err := tx.Query(ctx, `SELECT content_hash,mime_type,file_size,width,height
 FROM whiteboard.whiteboard_asset WHERE page_id=$1 AND content_hash=ANY($2::text[]) ORDER BY content_hash FOR SHARE`, page, hashes)
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		var actual whiteboardSnapshotAsset
		if err = rows.Scan(&actual.ContentHash, &actual.MimeType, &actual.ByteLength, &actual.Width, &actual.Height); err != nil {
			rows.Close()
			return err
		}
		if actual != expected[actual.ContentHash] {
			rows.Close()
			return errWhiteboardSnapshotAssetInvalid
		}
		count++
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if count != len(expected) {
		return errWhiteboardSnapshotAssetNotReady
	}
	// Rebuild from the exact inspected state, never from a client-supplied list or
	// a pre-existing association set lacking a completed inspection manifest.
	if _, err = tx.Exec(ctx, `DELETE FROM whiteboard.whiteboard_snapshot_asset WHERE page_id=$1 AND snapshot_id=$2`, page, snapshot); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_snapshot_asset(snapshot_id,page_id,content_hash)
 SELECT $2,$1,unnest($3::text[])`, page, snapshot, hashes); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO whiteboard.whiteboard_snapshot_asset_manifest(snapshot_id,page_id,state_digest,extractor_version,completed_at)
 VALUES($2,$1,$3,$4,now()) ON CONFLICT(snapshot_id) DO UPDATE SET state_digest=EXCLUDED.state_digest,
 extractor_version=EXCLUDED.extractor_version,completed_at=EXCLUDED.completed_at WHERE whiteboard.whiteboard_snapshot_asset_manifest.page_id=EXCLUDED.page_id`, page, snapshot, digest, full.AssetExtractorVersion)
	return err
}
