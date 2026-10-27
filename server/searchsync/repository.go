package searchsync

import (
	"context"
	"time"

	"github.com/durgakiran/beskar/searchtext"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const lockNamespace = 1936023922
const lockKey = 1

// database accepts a pool, transaction, or physical connection without changing
// which connection owns a transaction or the target session's advisory lock.
type database interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type outboxEvent struct {
	ID, PageID int64
	Attempts   int
}

func tryLeaderLock(ctx context.Context, db database) (bool, error) {
	var locked bool
	err := db.QueryRow(ctx, tryLeaderLockQuery, lockNamespace, lockKey).Scan(&locked)
	return locked, err
}

func releaseLeaderLock(ctx context.Context, db database) (bool, error) {
	var unlocked bool
	err := db.QueryRow(ctx, releaseLeaderLockQuery, lockNamespace, lockKey).Scan(&unlocked)
	return unlocked, err
}

func nextEvent(ctx context.Context, db database) (outboxEvent, error) {
	var event outboxEvent
	err := db.QueryRow(ctx, nextEventQuery).Scan(&event.ID, &event.PageID, &event.Attempts)
	return event, err
}

func syncDocument(ctx context.Context, db database, pageID int64, document *searchtext.PublishedDocument) error {
	if document == nil {
		_, err := db.Exec(ctx, deleteDocumentQuery, pageID)
		return err
	}
	d := document
	_, err := db.Exec(ctx, upsertDocumentQuery, d.SpaceID, d.CreatedBy, d.PageID, d.DocID, d.Title, d.BodyText, d.CreatedAt, d.UpdatedAt)
	return err
}

func completeEvent(ctx context.Context, db database, eventID int64) error {
	_, err := db.Exec(ctx, completeEventQuery, eventID, StatusCompleted)
	return err
}

func failEvent(ctx context.Context, db database, eventID int64, status StatusID, code string, delay time.Duration) error {
	_, err := db.Exec(ctx, failEventQuery, eventID, status, code, delay.Seconds(), StatusPending)
	return err
}

func enqueuePage(ctx context.Context, db database, pageID int64, reason ReasonID) error {
	_, err := db.Exec(ctx, enqueuePageQuery, pageID, reason)
	return err
}

func enqueueSpace(ctx context.Context, db database, spaceID uuid.UUID, reason ReasonID) error {
	_, err := db.Exec(ctx, enqueueSpaceQuery, spaceID, reason)
	return err
}

func backfillPages(ctx context.Context, db database, afterPageID int64, limit int) (int64, int, error) {
	rows, err := db.Query(ctx, backfillQuery, afterPageID, limit, ReasonBackfill)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	last, count := afterPageID, 0
	for rows.Next() {
		if err := rows.Scan(&last); err != nil {
			return 0, 0, err
		}
		count++
	}
	return last, count, rows.Err()
}

// OutboxStatus summarizes the queued events for one persisted status.
type OutboxStatus struct {
	Name   string
	Count  int64
	Oldest time.Time
}

// ReadOutboxStatus returns statuses in their persisted catalog order.
func ReadOutboxStatus(ctx context.Context, db database) ([]OutboxStatus, error) {
	rows, err := db.Query(ctx, outboxStatusQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (OutboxStatus, error) {
		var status OutboxStatus
		err := row.Scan(&status.Name, &status.Count, &status.Oldest)
		return status, err
	})
}

// ReplayFailed resets failed events after an operator repairs the underlying cause.
func ReplayFailed(ctx context.Context, db database) (int64, error) {
	tag, err := db.Exec(ctx, replayFailedQuery, StatusPending, StatusFailed)
	return tag.RowsAffected(), err
}

// ListIndexedPageIDs reads a bounded batch for reconciliation with current source state.
func ListIndexedPageIDs(ctx context.Context, db database, afterPageID int64, limit int) ([]int64, error) {
	rows, err := db.Query(ctx, indexedPageIDsQuery, afterPageID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}
