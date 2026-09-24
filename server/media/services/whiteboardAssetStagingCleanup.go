package media

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type WhiteboardStagingCleanupConfig struct {
	Enabled      bool
	Interval     time.Duration
	Expiry       time.Duration
	BatchSize    int
	MaxAttempts  int
	MaxBackoff   time.Duration
	DrainTimeout time.Duration
}

type WhiteboardStagingCleanupResult struct {
	Claimed   int
	Cleaned   int
	Failed    int
	Exhausted int
}

type WhiteboardStagingCleanupWorker struct {
	config        WhiteboardStagingCleanupConfig
	runOnce       func(context.Context) (WhiteboardStagingCleanupResult, error)
	writeMetadata func(context.Context, string, ...any) error
	cleanup       func(context.Context, whiteboardStagingCleanupCandidate) error
}

type whiteboardStagingCleanupCandidate struct {
	token    uuid.UUID
	pageID   int64
	hash     string
	actorID  string
	status   string
	attempts int
}

type whiteboardStagingCleanupPassContext struct {
	active       context.Context
	drainTimeout time.Duration
	drain        context.Context
	cancelDrain  context.CancelFunc
}

type WhiteboardStagingCleanupPass func(context.Context) (WhiteboardStagingCleanupResult, error)

func whiteboardCleanupBoolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func whiteboardCleanupDurationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	parsed, err := time.ParseDuration(value)
	if value == "" || err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func whiteboardCleanupIntEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	parsed, err := strconv.Atoi(value)
	if value == "" || err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func LoadWhiteboardStagingCleanupConfig() WhiteboardStagingCleanupConfig {
	return WhiteboardStagingCleanupConfig{
		Enabled:      whiteboardCleanupBoolEnv("WHITEBOARD_STAGING_CLEANUP_ENABLED", true),
		Interval:     whiteboardCleanupDurationEnv("WHITEBOARD_STAGING_CLEANUP_INTERVAL", time.Minute),
		Expiry:       whiteboardCleanupDurationEnv("WHITEBOARD_STAGING_CLEANUP_EXPIRY", 30*time.Minute),
		BatchSize:    whiteboardCleanupIntEnv("WHITEBOARD_STAGING_CLEANUP_BATCH_SIZE", 100),
		MaxAttempts:  whiteboardCleanupIntEnv("WHITEBOARD_STAGING_CLEANUP_MAX_ATTEMPTS", 8),
		MaxBackoff:   whiteboardCleanupDurationEnv("WHITEBOARD_STAGING_CLEANUP_MAX_BACKOFF", time.Hour),
		DrainTimeout: whiteboardCleanupDurationEnv("WHITEBOARD_STAGING_CLEANUP_DRAIN_TIMEOUT", 5*time.Second),
	}
}

func NewWhiteboardStagingCleanupWorker(config WhiteboardStagingCleanupConfig) *WhiteboardStagingCleanupWorker {
	return NewWhiteboardStagingCleanupWorkerWithPass(config, nil)
}

func NewWhiteboardStagingCleanupWorkerWithPass(config WhiteboardStagingCleanupConfig, pass WhiteboardStagingCleanupPass) *WhiteboardStagingCleanupWorker {
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = 8
	}
	if config.DrainTimeout <= 0 {
		config.DrainTimeout = 5 * time.Second
	}
	worker := &WhiteboardStagingCleanupWorker{config: config}
	worker.writeMetadata = func(ctx context.Context, query string, args ...any) error {
		_, err := core.GetPool().Exec(ctx, query, args...)
		return err
	}
	worker.cleanup = func(ctx context.Context, item whiteboardStagingCleanupCandidate) error {
		if item.status == "durable_cleanup_pending" {
			err := RollbackWhiteboardAsset(ctx, item.pageID, item.hash, item.actorID)
			if errors.Is(err, ErrWhiteboardAssetReferenced) || errors.Is(err, ErrWhiteboardAssetNotFound) {
				_, err = core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging
					SET status='cancelled', cleanup_error=NULL, next_cleanup_at=NULL, updated_at=now() WHERE token=$1`, item.token)
			}
			return err
		}
		return CancelWhiteboardAssetStaging(ctx, item.token, item.pageID, item.hash, item.actorID)
	}
	if pass == nil {
		worker.runOnce = worker.RunOnce
	} else {
		worker.runOnce = pass
	}
	return worker
}

func (w *WhiteboardStagingCleanupWorker) Start(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		w.run(ctx)
	}()
	return done
}

func (w *WhiteboardStagingCleanupWorker) run(ctx context.Context) {
	if !w.config.Enabled {
		return
	}
	if ctx.Err() != nil {
		return
	}
	w.runAndLog(ctx)
	ticker := time.NewTicker(w.config.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.runAndLog(ctx)
		}
	}
}

func newWhiteboardStagingCleanupPassContext(ctx context.Context, drainTimeout time.Duration) *whiteboardStagingCleanupPassContext {
	return &whiteboardStagingCleanupPassContext{active: ctx, drainTimeout: drainTimeout}
}

func (pass *whiteboardStagingCleanupPassContext) metadataWriteContext() context.Context {
	if pass.drain == nil {
		pass.drain, pass.cancelDrain = context.WithTimeout(context.WithoutCancel(pass.active), pass.drainTimeout)
	}
	return pass.drain
}

func (pass *whiteboardStagingCleanupPassContext) close() {
	if pass.cancelDrain != nil {
		pass.cancelDrain()
	}
}

func (w *WhiteboardStagingCleanupWorker) writeCleanupMetadataForPass(pass *whiteboardStagingCleanupPassContext, query string, args ...any) error {
	if pass.active.Err() == nil {
		err := w.writeMetadata(pass.active, query, args...)
		if err == nil || pass.active.Err() == nil {
			return err
		}
	}
	return w.writeMetadata(pass.metadataWriteContext(), query, args...)
}

func (w *WhiteboardStagingCleanupWorker) writeCleanupMetadata(ctx context.Context, query string, args ...any) error {
	pass := newWhiteboardStagingCleanupPassContext(ctx, w.config.DrainTimeout)
	defer pass.close()
	return w.writeCleanupMetadataForPass(pass, query, args...)
}

func (w *WhiteboardStagingCleanupWorker) runAndLog(ctx context.Context) {
	result, err := w.runOnce(ctx)
	if err != nil {
		core.Logger.Error("whiteboard staging cleanup pass failed", zap.Error(err))
		return
	}
	if result.Claimed > 0 {
		core.Logger.Info("whiteboard staging cleanup pass completed",
			zap.Int("claimed", result.Claimed), zap.Int("cleaned", result.Cleaned),
			zap.Int("failed", result.Failed), zap.Int("exhausted", result.Exhausted))
	}
}

func (w *WhiteboardStagingCleanupWorker) RunOnce(ctx context.Context) (WhiteboardStagingCleanupResult, error) {
	if w.config.BatchSize <= 0 || w.config.Expiry <= 0 || w.config.MaxAttempts <= 0 {
		return WhiteboardStagingCleanupResult{}, errors.New("invalid whiteboard staging cleanup configuration")
	}
	now := time.Now().UTC()
	rows, err := core.GetPool().Query(ctx, `WITH candidates AS (
		SELECT token FROM core.whiteboard_asset_staging
		WHERE ((status IN ('prepared','uploading','staged') AND updated_at <= $1)
			OR status IN ('cleanup_pending','durable_cleanup_pending'))
		  AND (next_cleanup_at IS NULL OR next_cleanup_at <= $2)
		ORDER BY updated_at, token
		FOR UPDATE SKIP LOCKED
		LIMIT $3
	)
	UPDATE core.whiteboard_asset_staging staging
	SET next_cleanup_at=$4
	FROM candidates WHERE staging.token=candidates.token
	RETURNING staging.token, staging.page_id, staging.content_hash, staging.created_by, staging.status, staging.cleanup_attempts`,
		now.Add(-w.config.Expiry), now, w.config.BatchSize, now.Add(w.config.Interval))
	if err != nil {
		return WhiteboardStagingCleanupResult{}, err
	}
	defer rows.Close()
	var candidates []whiteboardStagingCleanupCandidate
	for rows.Next() {
		var item whiteboardStagingCleanupCandidate
		if err := rows.Scan(&item.token, &item.pageID, &item.hash, &item.actorID, &item.status, &item.attempts); err != nil {
			return WhiteboardStagingCleanupResult{}, err
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		return WhiteboardStagingCleanupResult{}, err
	}

	return w.processCandidates(ctx, now, candidates)
}

func (w *WhiteboardStagingCleanupWorker) processCandidates(
	ctx context.Context,
	now time.Time,
	candidates []whiteboardStagingCleanupCandidate,
) (WhiteboardStagingCleanupResult, error) {
	result := WhiteboardStagingCleanupResult{Claimed: len(candidates)}
	pass := newWhiteboardStagingCleanupPassContext(ctx, w.config.DrainTimeout)
	defer pass.close()
	for _, item := range candidates {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		cleanupErr := w.cleanup(ctx, item)
		if cleanupErr == nil {
			result.Cleaned++
			if err := ctx.Err(); err != nil {
				return result, err
			}
			continue
		}
		result.Failed++
		attempts := item.attempts + 1
		if attempts >= w.config.MaxAttempts {
			err := w.writeCleanupMetadataForPass(pass, `UPDATE core.whiteboard_asset_staging
				SET status='cleanup_exhausted', cleanup_source_status=$2, cleanup_attempts=$3,
					cleanup_error=$4, cleanup_exhausted_at=now(), next_cleanup_at=NULL, updated_at=now()
				WHERE token=$1 AND status IN ('prepared','uploading','staged','cleanup_pending','durable_cleanup_pending','committed')`,
				item.token, item.status, attempts, cleanupErr.Error())
			if err != nil {
				return result, err
			}
			result.Exhausted++
			if err := ctx.Err(); err != nil {
				return result, err
			}
			continue
		}
		backoff := time.Second * time.Duration(1<<min(attempts-1, 10))
		if backoff > w.config.MaxBackoff {
			backoff = w.config.MaxBackoff
		}
		err := w.writeCleanupMetadataForPass(pass, `UPDATE core.whiteboard_asset_staging
			SET cleanup_attempts=$2, cleanup_error=$3, next_cleanup_at=$4, updated_at=now()
			WHERE token=$1 AND status IN ('prepared','uploading','staged','cleanup_pending','durable_cleanup_pending','committed')`,
			item.token, attempts, cleanupErr.Error(), now.Add(backoff))
		if err != nil {
			return result, err
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
	}
	return result, nil
}
