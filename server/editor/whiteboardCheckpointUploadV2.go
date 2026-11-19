package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errCheckpointUploadInvalid = errors.New("The assembled checkpoint is invalid. The edit remains in local recovery.")
	errCheckpointUploadBusy    = errors.New("Too many checkpoint uploads are pending for this board.")
)

const (
	checkpointUploadChunkSize = whiteboardCheckpointV2MaxUpdate
	checkpointUploadCapacity  = 8
	checkpointUploadReceipt   = `SELECT id, sequence, update_bytes, request_hash FROM whiteboard.whiteboard_update
 WHERE page_id=$1 AND actor_id=$2 AND idempotency_key=$3`
	checkpointUploadRead = `SELECT total_bytes, digest, data FROM whiteboard.whiteboard_checkpoint_upload
 WHERE page_id=$1 AND actor_id=$2 AND request_id=$3 AND restore_generation=$4 AND expires_at > now()`
	checkpointUploadCount = `SELECT count(*) FROM whiteboard.whiteboard_checkpoint_upload
 WHERE page_id=$1 AND restore_generation=$2 AND expires_at > now()`
	checkpointUploadCleanup = `DELETE FROM whiteboard.whiteboard_checkpoint_upload WHERE ctid IN (
 SELECT ctid FROM whiteboard.whiteboard_checkpoint_upload WHERE expires_at <= now()
 ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED)`
	checkpointUploadStore = `INSERT INTO whiteboard.whiteboard_checkpoint_upload
 (page_id, actor_id, request_id, restore_generation, total_bytes, digest, data, expires_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')
 ON CONFLICT (page_id, actor_id, request_id) DO UPDATE SET restore_generation=excluded.restore_generation,
 total_bytes=excluded.total_bytes, digest=excluded.digest, data=excluded.data, expires_at=excluded.expires_at`
	checkpointUploadDelete = `DELETE FROM whiteboard.whiteboard_checkpoint_upload
 WHERE page_id=$1 AND actor_id=$2 AND request_id=$3`
)

type whiteboardCheckpointUploadInput struct {
	checkpoint whiteboardCheckpointV2Input
	size       int
	digest     string
	offset     int
	chunk      []byte // nil for a progress query
}

type whiteboardCheckpointUploadResult struct {
	NextOffset int                           `json:"nextOffset"`
	Receipt    *whiteboardCheckpointV2Result `json:"receipt,omitempty"`
}

func checkpointUploadDigest(data []byte) string {
	return fmt.Sprintf("sha256:%x", sha256.Sum256(data))
}

func (service *whiteboardServiceV2) CheckpointUpload(ctx context.Context, in whiteboardCheckpointUploadInput) (whiteboardCheckpointUploadResult, error) {
	result, err := service.checkpointUploadTransaction(ctx, in)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
		return result, fmt.Errorf("%w: %w", errWhiteboardV2LockTimeout, err)
	}
	return result, err
}

func (service *whiteboardServiceV2) checkpointUploadTransaction(ctx context.Context, in whiteboardCheckpointUploadInput) (whiteboardCheckpointUploadResult, error) {
	result := whiteboardCheckpointUploadResult{}
	checkpoint := in.checkpoint
	tx, err := service.begin(ctx)
	if err != nil {
		return result, err
	}
	defer draftRollback(ctx, tx)
	draft, err := lockCheckpointDraft(ctx, tx, checkpoint)
	if err != nil {
		return result, err
	}

	receipt := whiteboardCheckpointV2Result{PageID: checkpoint.PageID}
	var committed []byte
	var hash string
	err = tx.QueryRow(ctx, checkpointUploadReceipt, checkpoint.PageID, checkpoint.ActorID, checkpoint.IdempotencyKey).
		Scan(&receipt.UpdateID, &receipt.Sequence, &committed, &hash)
	if err == nil {
		checkpoint.UpdateBytes = committed
		if len(committed) != in.size || checkpointUploadDigest(committed) != in.digest || hash != whiteboardCheckpointV2Hash(checkpoint) {
			return result, errWhiteboardV2KeyReuse
		}
		return whiteboardCheckpointUploadResult{NextOffset: in.size, Receipt: &receipt}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if draft.deleted {
		return result, errWhiteboardV2BoardNotFound
	}
	if draft.archived {
		return result, errWhiteboardV2Archived
	}

	var staged []byte
	var size int
	var digest string
	err = tx.QueryRow(ctx, checkpointUploadRead, checkpoint.PageID, checkpoint.ActorID, checkpoint.IdempotencyKey, checkpoint.RestoreGeneration).
		Scan(&size, &digest, &staged)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if err == nil && (size != in.size || digest != in.digest) {
		return result, errWhiteboardV2KeyReuse
	}

	result.NextOffset = len(staged)
	if in.chunk == nil || in.offset > result.NextOffset {
		return result, nil
	}
	if in.offset < result.NextOffset {
		end := in.offset + len(in.chunk)
		if end > len(staged) || !bytes.Equal(staged[in.offset:end], in.chunk) {
			return result, errWhiteboardV2KeyReuse
		}
		return result, nil
	}

	if _, err = tx.Exec(ctx, checkpointUploadCleanup); err != nil {
		return result, err
	}
	if len(staged) == 0 {
		var count int
		if err = tx.QueryRow(ctx, checkpointUploadCount, checkpoint.PageID, checkpoint.RestoreGeneration).Scan(&count); err != nil {
			return result, err
		}
		if count >= checkpointUploadCapacity {
			return result, errCheckpointUploadBusy
		}
	}
	data := append(staged, in.chunk...)
	result.NextOffset = len(data)
	if len(data) < in.size {
		if _, err = tx.Exec(ctx, checkpointUploadStore, checkpoint.PageID, checkpoint.ActorID, checkpoint.IdempotencyKey,
			checkpoint.RestoreGeneration, in.size, in.digest, data); err != nil {
			return result, err
		}
	} else {
		if len(data) != in.size || checkpointUploadDigest(data) != in.digest || validateYjsUpdateV1(data) != nil {
			return result, errCheckpointUploadInvalid
		}
		checkpoint.UpdateBytes = data
		if err = appendCheckpoint(ctx, tx, checkpoint, draft.head, whiteboardCheckpointV2Hash(checkpoint), &receipt); err != nil {
			return result, err
		}
		if _, err = tx.Exec(ctx, checkpointUploadDelete, checkpoint.PageID, checkpoint.ActorID, checkpoint.IdempotencyKey); err != nil {
			return result, err
		}
		result.Receipt = &receipt
	}
	if err = tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}
