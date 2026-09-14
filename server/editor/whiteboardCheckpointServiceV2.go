package editor

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errWhiteboardV2BoardNotFound = errors.New("whiteboard not found")
	errWhiteboardV2DraftMissing  = errors.New("whiteboard draft is missing")
)

func whiteboardCheckpointV2Hash(input whiteboardCheckpointV2Input) string {
	hash := sha256.New()
	hash.Write([]byte(input.UpdateEncoding))
	hash.Write([]byte{0})
	hash.Write(input.UpdateBytes)
	if input.RestoreGeneration != 0 {
		fmt.Fprintf(hash, "\x00generation:%d", input.RestoreGeneration)
	}
	if input.Title != nil {
		hash.Write([]byte{0})
		hash.Write([]byte(*input.Title))
	}
	return fmt.Sprintf("sha256:%x", hash.Sum(nil))
}

func (service *whiteboardServiceV2) CheckpointWhiteboard(ctx context.Context, input whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error) {
	if input.Title != nil {
		normalized, err := normalizeWhiteboardTitle(*input.Title)
		if err != nil {
			return whiteboardCheckpointV2Result{}, err
		}
		input.Title = normalized
	}
	result, err := service.checkpointTransaction(ctx, input)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
		return result, fmt.Errorf("%w: %w", errWhiteboardV2LockTimeout, err)
	}
	return result, err
}

func (service *whiteboardServiceV2) checkpointTransaction(ctx context.Context, input whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error) {
	result := whiteboardCheckpointV2Result{PageID: input.PageID}
	tx, err := service.begin(ctx)
	if err != nil {
		return result, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return result, err
	}
	// Lock order: space, board/page, draft. Shared locks stabilize membership and
	// lifecycle state; the exclusive draft lock serializes append and replay.
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, input.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	var pageID int64
	err = tx.QueryRow(ctx, whiteboardV2CheckpointLockBoard, input.PageID, input.SpaceID).Scan(&pageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return result, err
	}
	var head, generation int64
	err = tx.QueryRow(ctx, whiteboardV2CheckpointLockDraft, input.PageID).Scan(&head, &generation)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardV2DraftMissing
	}
	if err != nil {
		return result, err
	}
	if generation != input.RestoreGeneration {
		return result, errWhiteboardRestored
	}
	hash := whiteboardCheckpointV2Hash(input)
	var storedHash string
	err = tx.QueryRow(ctx, whiteboardV2CheckpointReceipt, input.PageID, input.ActorID, input.IdempotencyKey).Scan(&result.UpdateID, &result.Sequence, &storedHash)
	if err == nil {
		if storedHash != hash {
			return result, errWhiteboardV2KeyReuse
		}
		// Acknowledgement is stable even after later edits or archival. Rollback
		// releases read/row locks; no writes or permission provisioning on replay.
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if deleted {
		return result, errWhiteboardV2BoardNotFound
	}
	if archived {
		return result, errWhiteboardV2Archived
	}
	if head < 0 || head == math.MaxInt64 {
		return result, errors.New("invalid or exhausted draft sequence")
	}
	result.UpdateID, result.Sequence = uuid.New(), head+1
	if _, err = tx.Exec(ctx, whiteboardV2CheckpointInsert, result.UpdateID, input.PageID, result.Sequence,
		input.ActorID, input.IdempotencyKey, input.UpdateBytes, input.UpdateEncoding, hash); err != nil {
		return result, err
	}
	if input.Title != nil {
		if _, err = tx.Exec(ctx, whiteboardV2InsertTitle, input.PageID, result.Sequence, *input.Title); err != nil {
			return result, err
		}
	}
	tag, err := tx.Exec(ctx, whiteboardV2CheckpointAdvance, input.PageID, result.Sequence, input.ActorID)
	if err != nil {
		return result, err
	}
	if tag.RowsAffected() != 1 {
		return result, errWhiteboardV2DraftMissing
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}
