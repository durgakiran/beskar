package editor

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/jackc/pgx/v5"
)

var ErrWhiteboardRequestIDMisuse = errors.New("whiteboard request ID was reused with different content")

func SaveWhiteboardCheckpoint(ctx context.Context, input WhiteboardCheckpointInput) (WhiteboardCheckpointResult, *WhiteboardCheckpointConflict, error) {
	expectedRevision, err := strconv.ParseInt(input.ExpectedRevision, 10, 64)
	if err != nil || expectedRevision < 0 {
		return WhiteboardCheckpointResult{}, nil, errors.New("invalid expected whiteboard revision")
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return WhiteboardCheckpointResult{}, nil, err
	}
	defer tx.Rollback(ctx)

	requestHash := hashWhiteboardCheckpointRequest(input)
	var storedHash string
	var storedRevision int64
	var storedDigest string
	var storedServerSequence int64
	err = tx.QueryRow(ctx, getWhiteboardSaveRequest,
		input.DraftId, input.OwnerId, input.ClientId, input.RequestId,
	).Scan(&storedHash, &storedRevision, &storedDigest, &storedServerSequence)
	if err == nil {
		if storedHash != requestHash {
			return WhiteboardCheckpointResult{}, nil, ErrWhiteboardRequestIDMisuse
		}
		return WhiteboardCheckpointResult{
			DraftId:  input.DraftId,
			Revision: strconv.FormatInt(storedRevision, 10),
			AcknowledgedCheckpoint: WhiteboardAcknowledgedCheckpoint{
				TransactionSequence:  input.TransactionSequence,
				ServerUpdateSequence: storedServerSequence,
				StateDigest:          storedDigest,
			},
		}, nil, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return WhiteboardCheckpointResult{}, nil, err
	}

	var currentRevision int64
	var currentDigest string
	var currentServerSequence int64
	var currentData []byte
	if err := tx.QueryRow(ctx, lockWhiteboardDraftCheckpoint,
		input.PageId, input.SpaceId, input.DraftId,
	).Scan(&currentRevision, &currentDigest, &currentServerSequence, &currentData); err != nil {
		return WhiteboardCheckpointResult{}, nil, err
	}

	if currentRevision != expectedRevision {
		err = tx.QueryRow(ctx, getWhiteboardSaveRequest,
			input.DraftId, input.OwnerId, input.ClientId, input.RequestId,
		).Scan(&storedHash, &storedRevision, &storedDigest, &storedServerSequence)
		if err == nil {
			if storedHash != requestHash {
				return WhiteboardCheckpointResult{}, nil, ErrWhiteboardRequestIDMisuse
			}
			return WhiteboardCheckpointResult{
				DraftId:  input.DraftId,
				Revision: strconv.FormatInt(storedRevision, 10),
				AcknowledgedCheckpoint: WhiteboardAcknowledgedCheckpoint{
					TransactionSequence:  input.TransactionSequence,
					ServerUpdateSequence: storedServerSequence,
					StateDigest:          storedDigest,
				},
			}, nil, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return WhiteboardCheckpointResult{}, nil, err
		}
		return WhiteboardCheckpointResult{}, &WhiteboardCheckpointConflict{
			DraftId:              input.DraftId,
			Revision:             strconv.FormatInt(currentRevision, 10),
			StateDigest:          currentDigest,
			ServerUpdateSequence: currentServerSequence,
			Data:                 currentData,
		}, nil
	}

	var revision int64
	var serverSequence int64
	err = tx.QueryRow(ctx, upsertWhiteboardCheckpoint,
		input.DraftId, input.Data, input.StateDigest, expectedRevision,
	).Scan(&revision, &serverSequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return WhiteboardCheckpointResult{}, &WhiteboardCheckpointConflict{
			DraftId:              input.DraftId,
			Revision:             strconv.FormatInt(currentRevision, 10),
			StateDigest:          currentDigest,
			ServerUpdateSequence: currentServerSequence,
			Data:                 currentData,
		}, nil
	}
	if err != nil {
		return WhiteboardCheckpointResult{}, nil, err
	}

	if _, err := tx.Exec(ctx, insertWhiteboardSaveRequest,
		input.DraftId, input.OwnerId, input.ClientId, input.RequestId, requestHash,
		revision, input.StateDigest, serverSequence,
	); err != nil {
		return WhiteboardCheckpointResult{}, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WhiteboardCheckpointResult{}, nil, err
	}

	return WhiteboardCheckpointResult{
		DraftId:  input.DraftId,
		Revision: strconv.FormatInt(revision, 10),
		AcknowledgedCheckpoint: WhiteboardAcknowledgedCheckpoint{
			TransactionSequence:  input.TransactionSequence,
			ServerUpdateSequence: serverSequence,
			StateDigest:          input.StateDigest,
		},
	}, nil, nil
}

func hashWhiteboardCheckpointRequest(input WhiteboardCheckpointInput) string {
	hash := sha256.New()
	fmt.Fprintf(hash, "%d\x00%d\x00%s\x00%s\x00%s\x00", input.DraftId, input.TransactionSequence, input.ExpectedRevision, input.StateDigest, input.ClientId)
	hash.Write(input.Data)
	return fmt.Sprintf("sha256:%x", hash.Sum(nil))
}

func hashWhiteboardPublishRequest(input WhiteboardPublishInput) string {
	hash := sha256.New()
	fmt.Fprintf(hash, "%d\x00%d\x00%s\x00%d\x00%d\x00%s\x00%s\x00%s\x00",
		input.Id, input.DraftId, input.ExpectedDraftRevision,
		input.Checkpoint.TransactionSequence, input.Checkpoint.ServerUpdateSequence,
		input.Checkpoint.StateDigest, input.ClientId, input.PreviewAssetName,
	)
	hash.Write(input.Data)
	return fmt.Sprintf("sha256:%x", hash.Sum(nil))
}
