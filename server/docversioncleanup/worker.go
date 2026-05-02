package docversioncleanup

import (
	"context"
	"sync"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
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

func (w *Worker) setLastDryRun(result DryRunResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	copy := result
	w.stats.LastDryRun = &copy
}

func (w *Worker) setLastCleanup(result CleanupRunResult) {
	w.mu.Lock()
	defer w.mu.Unlock()
	copy := result
	w.stats.LastCleanup = &copy
}

func (w *Worker) Start(ctx context.Context) {
	if !w.config.Enabled {
		return
	}

	ticker := time.NewTicker(w.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.RunCleanupOnce(ctx); err != nil {
				core.Logger.Error("document version cleanup: run failed", zap.Error(err))
			}
		}
	}
}

func (w *Worker) RunDryRunOnce(ctx context.Context) (DryRunResult, error) {
	preflight, err := CheckPublishedDocCoveragePreflight(ctx)
	if err != nil {
		return DryRunResult{}, err
	}

	impact, err := EstimateDryRunImpact(ctx, w.config.DefaultRetentionDays, w.config.BatchSize)
	if err != nil {
		return DryRunResult{Preflight: preflight}, err
	}

	result := DryRunResult{
		Preflight:   preflight,
		Impact:      impact,
		CompletedAt: time.Now().UTC(),
	}
	w.setLastDryRun(result)
	core.Logger.Info("document version cleanup: dry run completed",
		zap.Bool("preflight_passed", preflight.Passed),
		zap.Int64("candidate_count", impact.CandidateVersionCount),
		zap.Int64("affected_page_count", impact.AffectedPageCount),
		zap.Int64("affected_account_count", impact.AffectedAccountCount),
	)
	return result, nil
}

func (w *Worker) RunCleanupOnce(ctx context.Context) (CleanupRunResult, error) {
	jobRunID := uuid.New()
	result := CleanupRunResult{
		JobRunID: jobRunID,
		DryRun:   w.config.DryRun,
	}

	preflight, err := CheckPublishedDocCoveragePreflight(ctx)
	if err != nil {
		return result, err
	}
	result.Preflight = preflight

	if w.config.DryRun {
		dryRun, err := w.RunDryRunOnce(ctx)
		if err != nil {
			return result, err
		}
		result.Preflight = dryRun.Preflight
		result.DryRunImpact = &dryRun.Impact
		result.CompletedAt = dryRun.CompletedAt
		w.setLastCleanup(result)
		return result, nil
	}

	if !preflight.Passed {
		result.CompletedAt = time.Now().UTC()
		w.setLastCleanup(result)
		core.Logger.Warn("document version cleanup: preflight failed",
			zap.Int64("checked_page_count", preflight.CheckedPageCount),
			zap.Int64("missing_page_count", preflight.MissingPageCount),
			zap.String("job_run_id", jobRunID.String()),
		)
		return result, ErrPublishedDocCoveragePreflightFailed
	}

	for result.PrunedVersionCount < w.config.MaxDocsPerRun {
		remaining := w.config.MaxDocsPerRun - result.PrunedVersionCount
		batchSize := minPositive(w.config.BatchSize, remaining)

		batch, err := PruneNextPageBatch(ctx, w.config.DefaultRetentionDays, batchSize, jobRunID)
		if err != nil {
			return result, err
		}
		if batch.PrunedVersionCount == 0 && batch.SkippedAfterRelock == 0 {
			break
		}

		result.Batches = append(result.Batches, batch)
		result.PrunedVersionCount += batch.PrunedVersionCount
		result.SkippedAfterRelock += batch.SkippedAfterRelock
		result.ContentRowsDeleted += batch.ContentRowsDeleted
		result.TextNodeRowsDeleted += batch.TextNodeRowsDeleted
		result.AssetReferenceRowsDeleted += batch.AssetReferenceRowsDeleted
	}

	result.ReachedRunCap = result.PrunedVersionCount >= w.config.MaxDocsPerRun
	result.CompletedAt = time.Now().UTC()
	w.setLastCleanup(result)
	core.Logger.Info("document version cleanup: cleanup run completed",
		zap.String("job_run_id", jobRunID.String()),
		zap.Int("deleted_count", result.PrunedVersionCount),
		zap.Int("skipped_after_relock", result.SkippedAfterRelock),
		zap.Int64("asset_reference_rows_deleted", result.AssetReferenceRowsDeleted),
		zap.Bool("reached_run_cap", result.ReachedRunCap),
	)
	return result, nil
}

func minPositive(a int, b int) int {
	if a <= 0 {
		return b
	}
	if b <= 0 {
		return a
	}
	if a < b {
		return a
	}
	return b
}
