package space

import (
	"context"
	"errors"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Space) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var spaceId uuid.UUID
	err := conn.QueryRow(ctx, INSERT_SPACE, s.Name, s.DateCreated, s.DateUpdated, s.CreatedBy).Scan(&spaceId)
	if err != nil {
		logger().Error(err.Error())
		return uuid.Nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_INSERTING_ROWS])
	}
	return spaceId, nil
}

func (s Space) Update() {}

func (s Space) Delete() {}

func createSpaceEntry(s Space) (uuid.UUID, error) {
	var spaceId uuid.UUID
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		// error while acquiring database connection
		logger().Error(err.Error())
		return spaceId, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	s.DateCreated = time.Now()
	s.DateUpdated = time.Now()
	spaceId, err = s.Create(tx, ctx)
	// create entry in permission system
	err = core.WriteRelations(spaceId.String(), "space", s.CreatedBy.String(), "user", "owner")
	if err != nil {
		logger().Error(err.Error())
		return spaceId, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	tx.Commit(ctx)
	return spaceId, nil
}

func ListSpaces(userId uuid.UUID) ([]Space, error) {
	var spaces []Space
	spaceIds := make([]string, 0)
	spaceIds, err := core.GetEntitiesWithPermission("space", "user", userId.String(), "view")
	if err != nil {
		// return error
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if len(spaceIds) == 0 {
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	defer conn.Conn().Close(ctx)
	if err != nil {
		// error while acquiring database connection
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}

	rows, err := conn.Query(ctx, GET_SPACES, spaceIds)
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	for rows.Next() {
		var r Space
		err := rows.Scan(&r.Id, &r.Name, &r.DateCreated, &r.DateUpdated, &r.CreatedBy)
		if err != nil {
			logger().Error(err.Error())
			return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		spaces = append(spaces, r)
	}
	if err = rows.Err(); err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	return spaces, nil
}

func getDocumentList(spaceId uuid.UUID, userId uuid.UUID) ([]PageList, error) {
	var pageList []PageList
	pageIds, err := core.GetEntitiesWithPermission("page", "space", spaceId.String(), "space")
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if len(pageIds) == 0 {
		return pageList, nil
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	defer conn.Conn().Close(ctx)
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	rows, err := conn.Query(ctx, GET_PAGE_LIST_QUERY, spaceId, pageIds)
	defer rows.Close()
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	pageList, err = pgx.CollectRows[PageList](rows, pgx.RowToStructByNameLax[PageList])
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	return pageList, nil
}
