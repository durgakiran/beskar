// Command searchsync provides explicit outbox maintenance. It does not migrate schema.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/durgakiran/beskar/searchsync"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	mode := flag.String("mode", "status", "status, backfill, reconcile, replay-failed, or once")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := searchsync.LoadConfig()
	if err != nil {
		return err
	}
	sourceConfig, err := loadSourceConfig()
	if err != nil {
		return err
	}
	source, err := pgxpool.NewWithConfig(ctx, sourceConfig)
	if err != nil {
		return fmt.Errorf("invalid source database configuration")
	}
	defer source.Close()
	switch *mode {
	case "status":
		queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		statuses, err := searchsync.ReadOutboxStatus(queryCtx, source)
		if err != nil {
			return fmt.Errorf("read outbox status failed")
		}
		for _, status := range statuses {
			fmt.Printf("%s count=%d oldest=%s\n", status.Name, status.Count, status.Oldest.UTC().Format(time.RFC3339))
		}
		return nil
	case "backfill":
		var cursor int64
		for ctx.Err() == nil {
			batchCtx, cancel := context.WithTimeout(ctx, cfg.TransactionTimeout)
			tx, err := source.Begin(batchCtx)
			if err != nil {
				cancel()
				return fmt.Errorf("begin backfill failed")
			}
			last, count, err := searchsync.Backfill(batchCtx, tx, cursor, cfg.BatchSize)
			if err == nil {
				err = tx.Commit(batchCtx)
			}
			cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
			_ = tx.Rollback(cleanup)
			done()
			cancel()
			if err != nil {
				return fmt.Errorf("backfill failed after page %d", cursor)
			}
			if count == 0 {
				return nil
			}
			cursor = last
			fmt.Printf("queued=%d through_page=%d\n", count, cursor)
		}
		return ctx.Err()
	case "replay-failed":
		queryCtx, cancel := context.WithTimeout(ctx, cfg.TransactionTimeout)
		defer cancel()
		// Operators repair the underlying problem before explicitly replaying failures.
		count, err := searchsync.ReplayFailed(queryCtx, source)
		if err != nil {
			return fmt.Errorf("replay failed")
		}
		fmt.Printf("replayed=%d\n", count)
		return nil
	case "once", "reconcile":
		cfg.WorkerEnabled = true
		target, err := searchsync.OpenTarget(ctx, cfg)
		if err != nil {
			return err
		}
		defer target.Close()
		if *mode == "reconcile" {
			var cursor int64
			for ctx.Err() == nil {
				batchCtx, cancel := context.WithTimeout(ctx, cfg.TransactionTimeout)
				ids, err := searchsync.ListIndexedPageIDs(batchCtx, target, cursor, cfg.BatchSize)
				if err != nil {
					cancel()
					return fmt.Errorf("read target IDs failed")
				}
				if len(ids) == 0 {
					cancel()
					return nil
				}
				tx, err := source.Begin(batchCtx)
				if err != nil {
					cancel()
					return fmt.Errorf("begin reconcile failed")
				}
				for _, id := range ids {
					if err = searchsync.EnqueuePage(batchCtx, tx, id, searchsync.ReasonReconcile); err != nil {
						break
					}
				}
				if err == nil {
					err = tx.Commit(batchCtx)
				}
				cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
				_ = tx.Rollback(cleanup)
				done()
				cancel()
				if err != nil {
					return fmt.Errorf("reconcile failed after page %d", cursor)
				}
				cursor = ids[len(ids)-1]
				fmt.Printf("queued=%d through_page=%d\n", len(ids), cursor)
			}
			return ctx.Err()
		}
		worker, err := searchsync.NewWorker(source, target, cfg, nil)
		if err != nil {
			return err
		}
		stats, err := worker.ProcessBatch(ctx)
		if err != nil {
			return fmt.Errorf("search batch failed; inspect outbox status and worker logs")
		}
		return json.NewEncoder(os.Stdout).Encode(stats)
	default:
		return fmt.Errorf("unknown mode %q", *mode)
	}
}
