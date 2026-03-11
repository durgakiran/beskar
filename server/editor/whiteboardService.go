package editor

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/core"
)

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
	err = tx.QueryRow(ctx, newPageWithType, d.SpaceId, d.OwnerId, -1, time.Now(), 1, "whiteboard").Scan(&pgId)
	if err != nil {
		logger().Error(fmt.Sprintf("CreateWhiteboard newPage err: %s", err.Error()))
		return 0, err
	}

	var dId int64
	// Insert into core.page_doc_map
	err = tx.QueryRow(ctx, newDoc, pgId, d.Title, time.Now(), d.OwnerId, 0).Scan(&dId)
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

func FetchWhiteboard(d WhiteboardInput) (WhiteboardData, error) {
	ctx := context.Background()

	var output WhiteboardData
	// Query core.whiteboard_data + page_doc_map using getWhiteboardData query
	row := core.GetPool().QueryRow(ctx, getWhiteboardData, d.Id, d.SpaceId)
	err := row.Scan(&output.Id, &output.DocId, &output.Data, &output.Title, &output.PageId, &output.SpaceId)
	if err != nil {
		if err.Error() == "no rows in result set" {
			// A whiteboard page exists but no data state was saved yet (fresh canvas)
			return WhiteboardData{}, nil
		}
		logger().Error(fmt.Sprintf("FetchWhiteboard queries err: %s", err.Error()))
		return WhiteboardData{}, err
	}

	return output, nil
}

func UpdateWhiteboard(d WhiteboardInput) error {
	ctx := context.Background()
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard tx err: %s", err.Error()))
		return err
	}
	defer tx.Rollback(ctx)

	// Fetch current valid docId for this page
	var dId int64
	err = tx.QueryRow(ctx, "SELECT doc_id FROM core.page_doc_map WHERE page_id = $1 ORDER BY version DESC LIMIT 1", d.Id).Scan(&dId)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard fetch docId err: %s", err.Error()))
		return err
	}

	var wdId int64
	// Upsert binary whiteboard yjs state
	err = tx.QueryRow(ctx, upsertWhiteboardData, dId, d.Data).Scan(&wdId)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard upsert data err: %s", err.Error()))
		return err
	}

	// Update the version timestamp to signal an update happened
	_, err = tx.Exec(ctx, "UPDATE core.page_doc_map SET version = $1 WHERE doc_id = $2", time.Now(), dId)
	if err != nil {
		logger().Error(fmt.Sprintf("UpdateWhiteboard update version err: %s", err.Error()))
		return err
	}

	err = tx.Commit(ctx)
	if err != nil {
		logger().Error(err.Error())
		return err
	}
	return nil
}

func DeleteWhiteboard(d WhiteboardInput) error {
	ctx := context.Background()
	_, err := core.GetPool().Exec(ctx, deleteDocumentQuery, d.Id, d.SpaceId)
	// Database cascade rules cover core.page_doc_map and core.whiteboard_data
	if err != nil {
		logger().Error(fmt.Sprintf("DeleteWhiteboard err: %s", err.Error()))
		return err
	}
	return nil
}
