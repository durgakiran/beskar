package searchsync

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/searchtext"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type Stats struct {
	Processed, Upserted, Deleted, Failed int
	Leader                               bool
}
type Worker struct {
	source, target *pgxpool.Pool
	config         Config
	logger         *zap.Logger
}

func NewWorker(source, target *pgxpool.Pool, c Config, logger *zap.Logger) (*Worker, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	if source == nil || (c.WorkerEnabled && target == nil) {
		return nil, fmt.Errorf("search sync requires source and enabled target pools")
	}
	if target != nil && source.Config().ConnConfig.Database == target.Config().ConnConfig.Database {
		return nil, fmt.Errorf("search target must use a separate database")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Worker{source: source, target: target, config: c, logger: logger}, nil
}

func (w *Worker) Start(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	if !w.config.WorkerEnabled {
		close(done)
		return done
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(w.config.PollInterval)
		defer ticker.Stop()
		for ctx.Err() == nil {
			stats, err := w.ProcessBatch(ctx)
			if err != nil && ctx.Err() == nil {
				w.logger.Error("search sync batch failed", zap.String("error_code", errorCode(err)))
			}
			if stats.Processed > 0 || stats.Failed > 0 {
				w.logger.Info("search sync batch", zap.Int("processed", stats.Processed), zap.Int("upserted", stats.Upserted), zap.Int("deleted", stats.Deleted), zap.Int("failed", stats.Failed))
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return done
}

// ProcessBatch fences all writes with one physical target connection's session
// lock. Never reconnect and reuse an extracted payload after losing leadership.
func (w *Worker) ProcessBatch(ctx context.Context) (Stats, error) {
	var stats Stats
	if w.target == nil {
		return stats, fmt.Errorf("search target pool is not configured")
	}
	acquireCtx, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
	conn, err := w.target.Acquire(acquireCtx)
	cancel()
	if err != nil {
		return stats, err
	}
	defer conn.Release()
	lockCtx, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
	stats.Leader, err = tryLeaderLock(lockCtx, conn.Conn())
	cancel()
	if err != nil {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = conn.Conn().Close(cleanup)
		return stats, err
	}
	if !stats.Leader {
		return stats, nil
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if unlocked, err := releaseLeaderLock(cleanup, conn.Conn()); err != nil || !unlocked {
			// A pooled session must never retain the singleton lock.
			_ = conn.Conn().Close(cleanup)
		}
	}()
	for i := 0; i < w.config.BatchSize && ctx.Err() == nil; i++ {
		step, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
		found, upserted, err := w.processOne(step, conn.Conn())
		cancel()
		if err != nil {
			return stats, err
		}
		if !found {
			break
		}
		stats.Processed++
		if upserted == nil {
			stats.Failed++
		} else if *upserted {
			stats.Upserted++
		} else {
			stats.Deleted++
		}
		if conn.Conn().IsClosed() {
			return stats, fmt.Errorf("search target connection lost")
		}
	}
	return stats, ctx.Err()
}

func rollback(tx pgx.Tx) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

func (w *Worker) processOne(ctx context.Context, target *pgx.Conn) (bool, *bool, error) {
	tx, err := w.source.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer rollback(tx)
	event, err := nextEvent(ctx, tx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	var document *searchtext.PublishedDocument
	err = searchtext.ReadPublished(ctx, tx, event.PageID, func(input searchtext.PublishedNodes) error {
		value, err := input.Generate()
		if err == nil {
			document = &value
		}
		return err
	})
	if err == nil {
		err = syncDocument(ctx, target, event.PageID, document)
	}
	if err == nil {
		err = completeEvent(ctx, tx, event.ID)
		if err == nil {
			err = tx.Commit(ctx)
		}
	}
	if err != nil {
		rollback(tx)
		// Record only a safe category, never body text, SQL parameters, or DSNs.
		failureCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		nextAttempts := event.Attempts + 1
		status := StatusPending
		if nextAttempts >= w.config.MaxAttempts {
			status = StatusFailed
		}
		recordErr := failEvent(failureCtx, w.source, event.ID, status, errorCode(err), w.config.retryDelay(nextAttempts))
		w.logger.Warn("search sync event failed", zap.Int64("event_id", event.ID), zap.Int64("page_id", event.PageID), zap.String("error_code", errorCode(err)))
		if recordErr != nil {
			return true, nil, recordErr
		}
		if target.IsClosed() {
			return true, nil, err
		}
		return true, nil, nil
	}
	upserted := document != nil
	return true, &upserted, nil
}

func errorCode(err error) string {
	var extraction *searchtext.Error
	if errors.As(err, &extraction) {
		return "extraction_" + extraction.Kind
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var database *pgconn.PgError
	if errors.As(err, &database) {
		return "postgres_" + database.Code
	}
	return "database_or_transport"
}
