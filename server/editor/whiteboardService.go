package editor

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/core"
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
func FetchPublishedWhiteboard(d WhiteboardInput) (WhiteboardData, error) {
	ctx := context.Background()
	var output WhiteboardData
	row := core.GetPool().QueryRow(ctx, getWhiteboardPublishedData, d.Id, d.SpaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.PreviewAssetName)
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
func FetchWhiteboardToEdit(d WhiteboardInput) (WhiteboardData, error) {
	ctx := context.Background()
	var output WhiteboardData
	
	row := core.GetPool().QueryRow(ctx, getWhiteboardDraftData, d.Id, d.SpaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId)
	
	if err == nil {
		return output, nil
	}
	
	if err == pgx.ErrNoRows {
		// Fallback to published
		row = core.GetPool().QueryRow(ctx, getWhiteboardPublishedData, d.Id, d.SpaceId)
		err = row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId, &output.PreviewAssetName)
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

func PublishWhiteboard(d WhiteboardPublishInput) error {
	ctx := context.Background()
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var publishedDocId int64
	err = tx.QueryRow(ctx, publishWhiteboardFlipDraft, d.Id).Scan(&publishedDocId)
	if err == pgx.ErrNoRows {
		// No draft row exists — this is an edge case (publish called twice rapidly).
		// Treat as a no-op rather than an error.
		tx.Rollback(ctx)
		return nil
	}
	if err != nil {
		logger().Error(fmt.Sprintf("PublishWhiteboard flip draft: %s", err.Error()))
		return err
	}

	// Upsert whiteboard_data for the now-published doc_id.
	_, err = tx.Exec(ctx, publishWhiteboardUpsertData, publishedDocId, d.Data, d.PreviewAssetName)
	if err != nil {
		logger().Error(fmt.Sprintf("PublishWhiteboard upsert data: %s", err.Error()))
		return err
	}

	return tx.Commit(ctx)
}

func ListWhiteboardVersions(pageId int64) ([]WhiteboardVersion, error) {
	ctx := context.Background()
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

func FetchWhiteboardByDocId(docId int64, spaceId uuid.UUID) (WhiteboardData, error) {
	ctx := context.Background()
	var output WhiteboardData
	row := core.GetPool().QueryRow(ctx, getWhiteboardDataByDocId, docId, spaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId)
	if err != nil {
		return WhiteboardData{}, err
	}
	return output, nil
}

func DeleteWhiteboard(d WhiteboardInput) error {
	ctx := context.Background()
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
	return tx.Commit(ctx)
}
