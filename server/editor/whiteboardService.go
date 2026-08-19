package editor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/core"
	media "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func normalizeWhiteboardParentId(parentId int64) int64 {
	if parentId <= 0 {
		return -1
	}
	return parentId
}

func CreateWhiteboard(d WhiteboardInput) (int64, error) {
	ctx := context.Background()
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		logger().Error(fmt.Sprintf("CreateWhiteboard tx: %s", err.Error()))
		return 0, err
	}
	defer tx.Rollback(ctx)

	var pgId int64
	// Insert into core.page with type = 'whiteboard'
	err = tx.QueryRow(ctx, newPageWithType, d.SpaceId, d.OwnerId, normalizeWhiteboardParentId(d.ParentId), time.Now(), 1, "whiteboard").Scan(&pgId)
	if err != nil {
		logger().Error(fmt.Sprintf("CreateWhiteboard newPage err: %s", err.Error()))
		return 0, err
	}

	var dId int64
	// Insert into core.page_doc_map
	err = tx.QueryRow(ctx, newDoc, pgId, d.Title, time.Now(), d.OwnerId, 1).Scan(&dId)
	if err != nil {
		logger().Error(fmt.Sprintf("CreateWhiteboard newDoc err: %s", err.Error()))
		return 0, err
	}

	// Create Permify subject permission logic exactly mimicking document creation
	core.CreateSubjectPermissions("page", strconv.FormatInt(pgId, 10), "space", d.SpaceId.String(), "space")

	err = tx.Commit(ctx)
	if err != nil {
		logger().Error(err.Error())
		return 0, err
	}
	return pgId, nil
}

// FetchPublishedWhiteboard fetches the latest published (draft=0) version.
// Used by the VIEW route. Returns pgx.ErrNoRows if the whiteboard has never been published.
func FetchPublishedWhiteboard(ctx context.Context, d WhiteboardInput) (WhiteboardData, error) {
	var output WhiteboardData
	row := core.GetPool().QueryRow(ctx, getWhiteboardPublishedData, d.Id, d.SpaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.PreviewAssetName, &output.DurableRevision, &output.StateDigest, &output.ServerUpdateSequence)
	if err != nil {
		if err == pgx.ErrNoRows {
			return WhiteboardData{}, err
		}
		logger().Error(fmt.Sprintf("FetchPublishedWhiteboard err: %s", err.Error()))
		return WhiteboardData{}, err
	}
	return output, nil
}

// FetchWhiteboardToEdit fetches the active draft (draft=1) for the EDIT route.
// If no draft exists, it falls back to the published version.
// The next auto-save will naturally create a new draft=1 row.
func FetchWhiteboardToEdit(ctx context.Context, d WhiteboardInput) (WhiteboardData, error) {
	var output WhiteboardData

	row := core.GetPool().QueryRow(ctx, getWhiteboardDraftData, d.Id, d.SpaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.DurableRevision, &output.StateDigest, &output.ServerUpdateSequence)

	if err == nil {
		return output, nil
	}

	if err == pgx.ErrNoRows {
		// Fallback to published
		row = core.GetPool().QueryRow(ctx, getWhiteboardPublishedData, d.Id, d.SpaceId)
		err = row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.PreviewAssetName, &output.DurableRevision, &output.StateDigest, &output.ServerUpdateSequence)
		if err != nil {
			return WhiteboardData{}, err
		}
		return output, nil
	}

	logger().Error(fmt.Sprintf("FetchWhiteboardToEdit err: %s", err.Error()))
	return WhiteboardData{}, err
}

func UpdateWhiteboard(d WhiteboardInput) error {
	ctx := context.Background()
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard tx err: %s", err.Error()))
		return err
	}
	defer tx.Rollback(ctx)

	// Try to find existing draft=1 row.
	var dId int64
	err = tx.QueryRow(ctx,
		"SELECT doc_id FROM core.page_doc_map WHERE page_id = $1 AND draft = 1 ORDER BY version DESC LIMIT 1",
		d.Id).Scan(&dId)

	if err == pgx.ErrNoRows {
		// No draft exists (just after a Publish) — create a new draft=1 row.
		err = tx.QueryRow(ctx, insertDraftWhiteboardDocMap, d.Id, d.OwnerId).Scan(&dId)
		if err != nil && err != pgx.ErrNoRows {
			logger().Error(fmt.Sprintf("UpdateWhiteboard insert draft doc map: %s", err.Error()))
			return err
		}
		if err == pgx.ErrNoRows {
			// Lost the race — another concurrent auto-save created the draft.
			err = tx.QueryRow(ctx,
				"SELECT doc_id FROM core.page_doc_map WHERE page_id = $1 AND draft = 1 ORDER BY version DESC LIMIT 1",
				d.Id).Scan(&dId)
			if err != nil {
				logger().Error(fmt.Sprintf("UpdateWhiteboard re-fetch draftDocId: %s", err.Error()))
				return err
			}
		}
	} else if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard fetch docId err: %s", err.Error()))
		return err
	}

	// Upsert the Yjs binary state.
	var wdId int64
	err = tx.QueryRow(ctx, upsertWhiteboardData, dId, d.Data).Scan(&wdId)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard upsert data err: %s", err.Error()))
		return err
	}

	// Bump version timestamp.
	_, err = tx.Exec(ctx, "UPDATE core.page_doc_map SET version = $1 WHERE doc_id = $2", time.Now(), dId)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard update version err: %s", err.Error()))
		return err
	}

	return tx.Commit(ctx)
}

func PublishWhiteboard(ctx context.Context, d WhiteboardPublishInput) (WhiteboardPublishResult, *WhiteboardCheckpointConflict, error) {
	expectedRevision, err := strconv.ParseInt(d.ExpectedDraftRevision, 10, 64)
	if err != nil || expectedRevision < 0 {
		return WhiteboardPublishResult{}, nil, errors.New("invalid expected whiteboard publish revision")
	}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	defer tx.Rollback(ctx)

	requestHash := hashWhiteboardPublishRequest(d)
	replay := func() (WhiteboardPublishResult, error) {
		var storedHash string
		var result WhiteboardPublishResult
		err := tx.QueryRow(ctx, getWhiteboardPublishRequest,
			d.Id, d.OwnerId, d.ClientId, d.RequestId,
		).Scan(&storedHash, &result.PublishedDocId, &result.NextDraftId)
		if err != nil {
			return WhiteboardPublishResult{}, err
		}
		if storedHash != requestHash {
			return WhiteboardPublishResult{}, ErrWhiteboardRequestIDMisuse
		}
		result.NextRevision = "0"
		return result, nil
	}
	if result, err := replay(); err == nil {
		return result, nil, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return WhiteboardPublishResult{}, nil, err
	}

	var currentRevision int64
	var currentDigest string
	var currentServerSequence int64
	var currentData []byte
	err = tx.QueryRow(ctx, lockWhiteboardDraftForPublish, d.Id, d.DraftId).
		Scan(&currentRevision, &currentDigest, &currentServerSequence, &currentData)
	if errors.Is(err, pgx.ErrNoRows) {
		if result, replayErr := replay(); replayErr == nil {
			return result, nil, nil
		}
		return WhiteboardPublishResult{}, nil, pgx.ErrNoRows
	}
	if err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	if currentRevision != expectedRevision ||
		currentServerSequence != d.Checkpoint.ServerUpdateSequence ||
		!bytes.Equal(currentData, d.Data) ||
		(currentDigest != "" && currentDigest != d.Checkpoint.StateDigest) {
		return WhiteboardPublishResult{}, &WhiteboardCheckpointConflict{
			DraftId:              d.DraftId,
			Revision:             strconv.FormatInt(currentRevision, 10),
			StateDigest:          currentDigest,
			ServerUpdateSequence: currentServerSequence,
			Data:                 currentData,
		}, nil
	}

	if _, err := tx.Exec(ctx, publishCheckedWhiteboardDraft, d.Id, d.DraftId); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	if _, err := tx.Exec(ctx, updatePublishedWhiteboardPreview, d.DraftId, d.PreviewAssetName); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}

	result := WhiteboardPublishResult{PublishedDocId: d.DraftId, NextRevision: "0"}
	if err := tx.QueryRow(ctx, insertNextWhiteboardDraft, d.DraftId, d.OwnerId).Scan(&result.NextDraftId); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	if _, err := tx.Exec(ctx, seedNextWhiteboardDraft, result.NextDraftId, d.Data, d.Checkpoint.StateDigest); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	if _, err := tx.Exec(ctx, insertWhiteboardPublishRequest,
		d.Id, d.OwnerId, d.ClientId, d.RequestId, requestHash,
		d.DraftId, result.PublishedDocId, result.NextDraftId,
	); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return WhiteboardPublishResult{}, nil, err
	}
	return result, nil, nil
}

func ListWhiteboardVersions(ctx context.Context, pageId int64) ([]WhiteboardVersion, error) {
	rows, err := core.GetPool().Query(ctx, getWhiteboardVersions, pageId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []WhiteboardVersion
	for rows.Next() {
		var v WhiteboardVersion
		if err := rows.Scan(&v.DocId, &v.Version, &v.PreviewAssetName); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

func FetchWhiteboardByDocId(ctx context.Context, docId int64, spaceId uuid.UUID) (WhiteboardData, error) {
	var output WhiteboardData
	row := core.GetPool().QueryRow(ctx, getWhiteboardDataByDocId, docId, spaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.DurableRevision, &output.StateDigest, &output.ServerUpdateSequence)
	if err != nil {
		return WhiteboardData{}, err
	}
	return output, nil
}

func DeleteWhiteboard(d WhiteboardInput) error {
	ctx := context.Background()
	assetStorageKeys, err := media.ListWhiteboardAssetStorageKeys(ctx, d.Id)
	if err != nil {
		return err
	}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := quota.ReleasePageStorageUsageTx(ctx, tx, d.SpaceId, d.Id, "whiteboard_delete"); err != nil {
		logger().Error(fmt.Sprintf("DeleteWhiteboard release quota err: %s", err.Error()))
		return err
	}
	_, err = tx.Exec(ctx, deleteDocumentQuery, d.Id, d.SpaceId)
	// Database cascade rules cover core.page_doc_map and core.whiteboard_data
	if err != nil {
		logger().Error(fmt.Sprintf("DeleteWhiteboard err: %s", err.Error()))
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if err := media.DeleteWhiteboardAssetObjects(ctx, assetStorageKeys); err != nil {
		// The page and catalog rows are already deleted. Retaining an orphaned
		// immutable object is safer than rolling document deletion back.
		logger().Error(fmt.Sprintf("DeleteWhiteboard asset cleanup err: %s", err.Error()))
	}
	return nil
}
