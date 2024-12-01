package page

import (
	"context"
	"errors"

	"github.com/durgakiran/beskar/core"
)

func getPageBreadCrumbs(pageId int64) ([]Crumb, error) {
	pool := core.GetPool()
	ctx := context.Background()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		core.Logger.Error("Unable to acquire a connection: " + err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_PAGE_BREAD_CRUMBS, pageId)
	if err != nil {
		core.Logger.Error("Unable to get rows: " + err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	var crumbs []Crumb
	for rows.Next() {
		var crumb Crumb
		err := rows.Scan(&crumb.Id, &crumb.ParentId, &crumb.Name)
		if err != nil {
			core.Logger.Error("Unable to scan rows: " + err.Error())
			return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		crumbs = append(crumbs, crumb)
	}
	return crumbs, nil
}
