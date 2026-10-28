package searchsync

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// QueuePage is a producer hook. Capture is independent of target availability;
// the append commits or rolls back with the caller's source mutation.
func QueuePage(ctx context.Context, tx pgx.Tx, pageID int64, reason ReasonID) error {
	enabled, err := boolEnv("SEARCH_SYNC_CAPTURE_ENABLED")
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	return EnqueuePage(ctx, tx, pageID, reason)
}

// EnqueuePage also supports explicit backfill/replay without enabling producers.
func EnqueuePage(ctx context.Context, tx pgx.Tx, pageID int64, reason ReasonID) error {
	if tx == nil || pageID <= 0 || reason <= 0 {
		return fmt.Errorf("invalid search sync event")
	}
	return enqueuePage(ctx, tx, pageID, reason)
}

// QueueSpace includes inactive pages so archive/delete events remove existing
// target records. The outbox deliberately has no page foreign key.
func QueueSpace(ctx context.Context, tx pgx.Tx, spaceID uuid.UUID, reason ReasonID) error {
	enabled, err := boolEnv("SEARCH_SYNC_CAPTURE_ENABLED")
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	if tx == nil || spaceID == uuid.Nil || reason <= 0 {
		return fmt.Errorf("invalid search sync space event")
	}
	return enqueueSpace(ctx, tx, spaceID, reason)
}

// Backfill enqueues pages and already-indexed IDs via separate calls. Every work
// item resolves current state; this never snapshots an old document payload.
func Backfill(ctx context.Context, tx pgx.Tx, afterPageID int64, limit int) (int64, int, error) {
	if afterPageID < 0 || limit < 1 || limit > 1000 {
		return 0, 0, fmt.Errorf("invalid search backfill cursor or limit")
	}
	return backfillPages(ctx, tx, afterPageID, limit)
}
