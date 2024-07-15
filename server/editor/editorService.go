package editor

import (
	"context"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

const (
	newPage    = "INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status) VALUES ($1, $2, $3, $4, $5) RETURNING id"
	newDoc     = "INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft) VALUES ($1, $2, $3, $4, $5) RETURNING doc_id"
	newContent = "INSERT INTO core.content (doc_id, parent_id, order, type, attrs, marks, text) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"
)

func logger() *zap.Logger {
	return core.Logger
}

func (p Page) Create(conn pgx.Tx, ctx context.Context) (int64, error) {
	var pageId int64
	err := conn.QueryRow(ctx, newPage, p.SpaceId, p.OwnerId, p.ParentId, p.DateCreated, p.Status).Scan(&pageId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Print(err)
		logger().Error(err.Error())
		return int64(0), err
		// conn.Rollback(ctx)
	}
	return pageId, nil
}

func (p Page) Update() int64 {
	return int64(0)
}

func (p Page) Publish() int64 {
	return int64(0)
}

func (p Page) Delete() int64 {
	return int64(0)
}

func (d Doc) Create(conn pgx.Tx, ctx context.Context) (int64, error) {
	var docId int64
	err := conn.QueryRow(ctx, newDoc, d.PageId, d.Title, d.Version, d.OwnerId, d.Draft).Scan(&docId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating doc %v \n", err.Error())
		return int64(0), err
		// conn.Rollback(ctx)
	}
	return docId, nil
}

func (d Doc) Update() int64 {
	return int64(0)
}

func (d Doc) Publish() int64 {
	return int64(0)
}

func (d Doc) Delete() int64 {
	return int64(0)
}

func (c ContentNode) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var docId uuid.UUID
	err := conn.QueryRow(ctx, newContent, c.DocId, c.ParentId, c.OrderId, c.Type, c.Attributes, c.Marks, c.Text).Scan(&docId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating Content %v \n", err.Error())
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return docId, nil
}

func (c ContentNode) Update() int64 {
	return int64(0)
}

func (c ContentNode) Publish() int64 {
	return int64(0)
}

func (c ContentNode) Delete() int64 {
	return int64(0)
}

func (document InputDocument) Create() (int64, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	// create page
	page := Page{SpaceId: document.SpaceId, OwnerId: document.OwnerId, ParentId: document.ParentId, DateCreated: time.Now(), Status: 0}
	pageId, err := page.Create(tx, ctx)
	if err != nil {
		return pageId, err
	}
	// create doc
	doc := Doc{PageId: pageId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 0}
	docId, err := doc.Create(tx, ctx)
	if err != nil {
		return pageId, err
	}
	// create content
	for _, child := range document.New {
		child.DocId = docId
		_, err := child.Create(tx, ctx)
		if err != nil {
			return pageId, err
		}
	}
	tx.Commit(ctx)
	// return created page id
	return pageId, nil
}
