package assetcleanup

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/google/uuid"
)

func RestoreAsset(ctx context.Context, assetType string, assetID string) (RestoreResult, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return RestoreResult{}, err
	}
	defer tx.Rollback(ctx)

	var (
		result    RestoreResult
		pageID    int64
		spaceID   uuid.UUID
		sizeBytes int64
		deletedAt *time.Time
		purgedAt  *time.Time
	)

	switch assetType {
	case assetref.AssetTypeAttachment:
		err = tx.QueryRow(ctx, getAttachmentForRestoreQuery, assetID).Scan(&result.AssetID, &pageID, &spaceID, &sizeBytes, &deletedAt, &purgedAt)
	case assetref.AssetTypeImage:
		err = tx.QueryRow(ctx, getImageForRestoreQuery, assetID).Scan(&result.AssetID, &pageID, &spaceID, &sizeBytes, &deletedAt, &purgedAt)
	default:
		return RestoreResult{}, fmt.Errorf("unsupported asset type: %s", assetType)
	}
	if err != nil {
		return RestoreResult{}, err
	}

	result.AssetType = assetType
	result.PageID = pageID
	result.SpaceID = spaceID

	if deletedAt == nil {
		return result, nil
	}
	if purgedAt != nil {
		return result, errors.New("asset blob already purged; restore requires object-version recovery")
	}

	switch assetType {
	case assetref.AssetTypeAttachment:
		_, err = tx.Exec(ctx, restoreAttachmentQuery, assetID)
	case assetref.AssetTypeImage:
		_, err = tx.Exec(ctx, restoreImageQuery, assetID)
	}
	if err != nil {
		return RestoreResult{}, err
	}

	if err := quota.ApplyStorageUsageDeltaTx(ctx, tx, spaceID, sizeBytes, "cleanup_restore", assetType+"_cleanup", assetID, map[string]any{
		"pageId":    pageID,
		"assetType": assetType,
		"assetId":   assetID,
	}); err != nil {
		return RestoreResult{}, err
	}

	result.BytesRestored = sizeBytes
	result.WasRestored = true
	if err := tx.Commit(ctx); err != nil {
		return RestoreResult{}, err
	}
	return result, nil
}
