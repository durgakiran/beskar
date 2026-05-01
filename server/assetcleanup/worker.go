package assetcleanup

import (
	"context"
	"errors"
	"io/fs"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

type Worker struct {
	config Config
	mu     sync.RWMutex
	stats  runtimeStats
}

func NewWorker(config Config) *Worker {
	return &Worker{config: config}
}

func (w *Worker) Status() runtimeStats {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.stats
}

func (w *Worker) setLastMarkRun(result MarkRunResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	copy := result
	w.stats.LastMarkRun = &copy
}

func (w *Worker) setLastPurgeRun(result PurgeRunResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	copy := result
	w.stats.LastPurgeRun = &copy
}

func (w *Worker) Start(ctx context.Context) {
	if !w.config.Enabled {
		return
	}

	markTicker := time.NewTicker(w.config.MarkInterval)
	defer markTicker.Stop()

	var purgeTicker *time.Ticker
	var purgeC <-chan time.Time
	if w.config.PurgeEnabled {
		purgeTicker = time.NewTicker(w.config.PurgeInterval)
		purgeC = purgeTicker.C
		defer purgeTicker.Stop()
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-markTicker.C:
			if _, err := w.RunMarkOnce(ctx); err != nil {
				core.Logger.Error("asset cleanup: mark pass failed", zap.Error(err))
			}
		case <-purgeC:
			if _, err := w.RunPurgeOnce(ctx); err != nil {
				core.Logger.Error("asset cleanup: purge pass failed", zap.Error(err))
			}
		}
	}
}

func loadCleanupEligiblePages(ctx context.Context, limit int) ([]int64, error) {
	rows, err := core.GetPool().Query(ctx, listCleanupEligiblePagesQuery, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (int64, error) {
		var pageID int64
		err := row.Scan(&pageID)
		return pageID, err
	})
}

func loadPageAssets(ctx context.Context, pageID int64) ([]assetRow, error) {
	assets := make([]assetRow, 0)
	load := func(query string) error {
		rows, err := core.GetPool().Query(ctx, query, pageID)
		if err != nil {
			return err
		}
		defer rows.Close()
		part, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (assetRow, error) {
			var rec assetRow
			err := row.Scan(
				&rec.AssetType,
				&rec.AssetID,
				&rec.PageID,
				&rec.SpaceID,
				&rec.SizeBytes,
				&rec.StorageKey,
				&rec.OrphanedAt,
				&rec.DeletedAt,
				&rec.PurgedAt,
			)
			return rec, err
		})
		if err != nil {
			return err
		}
		assets = append(assets, part...)
		return nil
	}

	if err := load(listPageAttachmentAssetsQuery); err != nil {
		return nil, err
	}
	if err := load(listPageImageAssetsQuery); err != nil {
		return nil, err
	}
	sort.Slice(assets, func(i, j int) bool {
		if assets[i].AssetType == assets[j].AssetType {
			return assets[i].AssetID < assets[j].AssetID
		}
		return assets[i].AssetType < assets[j].AssetType
	})
	return assets, nil
}

func loadLiveReferences(ctx context.Context, pageID int64) (map[string]struct{}, error) {
	rows, err := core.GetPool().Query(ctx, listLiveReferencesByPageQuery, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	live := map[string]struct{}{}
	for rows.Next() {
		var ref liveReference
		if err := rows.Scan(&ref.AssetType, &ref.AssetID); err != nil {
			return nil, err
		}
		live[ref.AssetType+"\x00"+ref.AssetID] = struct{}{}
	}
	return live, rows.Err()
}

func clearOrphanedAt(ctx context.Context, tx pgx.Tx, asset assetRow) error {
	switch asset.AssetType {
	case assetref.AssetTypeAttachment:
		_, err := tx.Exec(ctx, clearAttachmentOrphanedAtQuery, asset.AssetID)
		return err
	case assetref.AssetTypeImage:
		_, err := tx.Exec(ctx, clearImageOrphanedAtQuery, asset.AssetID)
		return err
	default:
		return errors.New("unsupported asset type")
	}
}

func markOrphanedAt(ctx context.Context, tx pgx.Tx, asset assetRow, at time.Time) error {
	switch asset.AssetType {
	case assetref.AssetTypeAttachment:
		_, err := tx.Exec(ctx, markAttachmentOrphanedAtQuery, asset.AssetID, at)
		return err
	case assetref.AssetTypeImage:
		_, err := tx.Exec(ctx, markImageOrphanedAtQuery, asset.AssetID, at)
		return err
	default:
		return errors.New("unsupported asset type")
	}
}

func softDeleteAsset(ctx context.Context, tx pgx.Tx, asset assetRow, at time.Time) error {
	switch asset.AssetType {
	case assetref.AssetTypeAttachment:
		if _, err := tx.Exec(ctx, softDeleteAttachmentQuery, asset.AssetID, at); err != nil {
			return err
		}
	case assetref.AssetTypeImage:
		if _, err := tx.Exec(ctx, softDeleteImageQuery, asset.AssetID, at); err != nil {
			return err
		}
	default:
		return errors.New("unsupported asset type")
	}

	sourceType := "attachment_cleanup"
	if asset.AssetType == assetref.AssetTypeImage {
		sourceType = "image_cleanup"
	}
	return quota.ApplyStorageUsageDeltaTx(ctx, tx, asset.SpaceID, -asset.SizeBytes, "cleanup_delete", sourceType, asset.AssetID, map[string]any{
		"pageId":    asset.PageID,
		"assetType": asset.AssetType,
		"assetId":   asset.AssetID,
	})
}

func (w *Worker) RunMarkOnce(ctx context.Context) (MarkRunResult, error) {
	pageLimit := max(1000, w.config.MaxMarksPerRun*4)
	pages, err := loadCleanupEligiblePages(ctx, pageLimit)
	if err != nil {
		return MarkRunResult{}, err
	}

	result := MarkRunResult{}
	now := time.Now().UTC()
	cutoff := now.Add(-w.config.OrphanGrace)

	for _, pageID := range pages {
		assets, err := loadPageAssets(ctx, pageID)
		if err != nil {
			return result, err
		}
		liveRefs, err := loadLiveReferences(ctx, pageID)
		if err != nil {
			return result, err
		}
		result.PagesScanned++

		var tx pgx.Tx
		if !w.config.DryRun {
			tx, err = core.GetPool().Begin(ctx)
			if err != nil {
				return result, err
			}
		}

		pageErr := error(nil)
		mutations := result.AssetsMarked + result.AssetsDeleted
		for _, asset := range assets {
			referenced := false
			if _, ok := liveRefs[asset.AssetType+"\x00"+asset.AssetID]; ok {
				referenced = true
			}

			if referenced {
				if asset.OrphanedAt != nil {
					result.AssetsReactivated++
					core.Logger.Info("asset cleanup: asset referenced again",
						zap.String("asset_type", asset.AssetType),
						zap.String("asset_id", asset.AssetID),
						zap.Int64("page_id", asset.PageID),
						zap.Bool("dry_run", w.config.DryRun),
					)
					if !w.config.DryRun {
						if err := clearOrphanedAt(ctx, tx, asset); err != nil {
							pageErr = err
							break
						}
					}
				}
				continue
			}

			if mutations >= w.config.MaxMarksPerRun {
				result.ReachedRunCap = true
				break
			}

			if asset.OrphanedAt == nil {
				result.AssetsMarked++
				mutations++
				core.Logger.Info("asset cleanup: asset newly orphaned",
					zap.String("asset_type", asset.AssetType),
					zap.String("asset_id", asset.AssetID),
					zap.Int64("page_id", asset.PageID),
					zap.Bool("dry_run", w.config.DryRun),
				)
				if !w.config.DryRun {
					if err := markOrphanedAt(ctx, tx, asset, now); err != nil {
						pageErr = err
						break
					}
				}
				continue
			}

			if asset.OrphanedAt.After(cutoff) {
				continue
			}

			result.AssetsDeleted++
			result.BytesRemoved += asset.SizeBytes
			mutations++
			core.Logger.Info("asset cleanup: soft deleting orphaned asset",
				zap.String("asset_type", asset.AssetType),
				zap.String("asset_id", asset.AssetID),
				zap.Int64("page_id", asset.PageID),
				zap.Int64("bytes", asset.SizeBytes),
				zap.Bool("dry_run", w.config.DryRun),
			)
			if !w.config.DryRun {
				if err := softDeleteAsset(ctx, tx, asset, now); err != nil {
					pageErr = err
					break
				}
			}
		}

		if tx != nil {
			if pageErr != nil {
				tx.Rollback(ctx)
				return result, pageErr
			}
			if err := tx.Commit(ctx); err != nil {
				return result, err
			}
		}
		if result.ReachedRunCap {
			break
		}
	}

	result.CompletedAt = now
	w.setLastMarkRun(result)
	core.Logger.Info("asset cleanup: mark pass completed",
		zap.Int("pages_scanned", result.PagesScanned),
		zap.Int("assets_marked", result.AssetsMarked),
		zap.Int("assets_deleted", result.AssetsDeleted),
		zap.Int("assets_reactivated", result.AssetsReactivated),
		zap.Int64("bytes_removed", result.BytesRemoved),
		zap.Bool("reached_run_cap", result.ReachedRunCap),
		zap.Bool("dry_run", w.config.DryRun),
	)
	return result, nil
}

func loadPurgeCandidates(ctx context.Context, query string, cutoff time.Time, limit int) ([]assetRow, error) {
	rows, err := core.GetPool().Query(ctx, query, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (assetRow, error) {
		var rec assetRow
		err := row.Scan(
			&rec.AssetType,
			&rec.AssetID,
			&rec.PageID,
			&rec.SpaceID,
			&rec.SizeBytes,
			&rec.StorageKey,
			&rec.OrphanedAt,
			&rec.DeletedAt,
			&rec.PurgedAt,
		)
		return rec, err
	})
}

func hasLiveReferences(ctx context.Context, asset assetRow) (bool, error) {
	var count int
	err := core.GetPool().QueryRow(ctx, countLiveRefsForAssetQuery, asset.AssetType, asset.AssetID).Scan(&count)
	return count > 0, err
}

func setPurgedAt(ctx context.Context, tx pgx.Tx, asset assetRow, at time.Time) error {
	switch asset.AssetType {
	case assetref.AssetTypeAttachment:
		_, err := tx.Exec(ctx, setAttachmentPurgedAtQuery, asset.AssetID, at)
		return err
	case assetref.AssetTypeImage:
		_, err := tx.Exec(ctx, setImagePurgedAtQuery, asset.AssetID, at)
		return err
	default:
		return errors.New("unsupported asset type")
	}
}

func deleteBlob(ctx context.Context, asset assetRow) error {
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return err
	}

	key := strings.TrimSpace(asset.StorageKey)
	if asset.AssetType == assetref.AssetTypeAttachment {
		key, err = core.NormalizeAttachmentStoragePath(asset.StorageKey)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
	}

	return store.Delete(ctx, key)
}

func (w *Worker) RunPurgeOnce(ctx context.Context) (PurgeRunResult, error) {
	result := PurgeRunResult{}
	if !w.config.PurgeEnabled {
		result.CompletedAt = time.Now().UTC()
		w.setLastPurgeRun(result)
		core.Logger.Info("asset cleanup: purge pass skipped because purge is disabled",
			zap.Bool("dry_run", w.config.DryRun),
		)
		return result, nil
	}

	cutoff := time.Now().UTC().Add(-w.config.PurgeGrace)

	loadLimit := max(1, w.config.MaxPurgesPerRun)
	attachmentCandidates, err := loadPurgeCandidates(ctx, listAttachmentPurgeCandidatesQuery, cutoff, loadLimit)
	if err != nil {
		return result, err
	}
	imageCandidates, err := loadPurgeCandidates(ctx, listImagePurgeCandidatesQuery, cutoff, loadLimit)
	if err != nil {
		return result, err
	}
	candidates := append(attachmentCandidates, imageCandidates...)
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].DeletedAt == nil {
			return false
		}
		if candidates[j].DeletedAt == nil {
			return true
		}
		if candidates[i].DeletedAt.Equal(*candidates[j].DeletedAt) {
			return candidates[i].AssetID < candidates[j].AssetID
		}
		return candidates[i].DeletedAt.Before(*candidates[j].DeletedAt)
	})

	now := time.Now().UTC()
	for _, asset := range candidates {
		if result.AssetsPurged >= w.config.MaxPurgesPerRun {
			result.ReachedRunCap = true
			break
		}

		live, err := hasLiveReferences(ctx, asset)
		if err != nil {
			return result, err
		}
		if live {
			core.Logger.Warn("asset cleanup: purge skipped because asset became live again",
				zap.String("asset_type", asset.AssetType),
				zap.String("asset_id", asset.AssetID),
				zap.Int64("page_id", asset.PageID),
			)
			continue
		}

		core.Logger.Info("asset cleanup: purging blob",
			zap.String("asset_type", asset.AssetType),
			zap.String("asset_id", asset.AssetID),
			zap.Int64("page_id", asset.PageID),
			zap.Bool("dry_run", w.config.DryRun),
		)

		if !w.config.DryRun {
			if err := deleteBlob(ctx, asset); err != nil {
				return result, err
			}

			tx, err := core.GetPool().Begin(ctx)
			if err != nil {
				return result, err
			}
			if err := setPurgedAt(ctx, tx, asset, now); err != nil {
				tx.Rollback(ctx)
				return result, err
			}
			if err := tx.Commit(ctx); err != nil {
				return result, err
			}
		}

		result.AssetsPurged++
		result.BytesPurged += asset.SizeBytes
	}

	result.CompletedAt = now
	w.setLastPurgeRun(result)
	core.Logger.Info("asset cleanup: purge pass completed",
		zap.Int("assets_purged", result.AssetsPurged),
		zap.Int64("bytes_purged", result.BytesPurged),
		zap.Bool("reached_run_cap", result.ReachedRunCap),
		zap.Bool("dry_run", w.config.DryRun),
	)
	return result, nil
}
