package editor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

const (
	newPage        = "INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status) VALUES ($1, $2, $3, $4, $5) RETURNING id"
	newDoc         = "INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft) VALUES ($1, $2, $3, $4, $5) RETURNING doc_id"
	newContent     = "INSERT INTO core.content (id, doc_id, parent_id, \"order\", type, attrs, marks, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
	getSpace       = "SELECT id, name, date_created AS dateCreated, date_updated AS dateUpdated, user_id AS userId FROM core.space WHERE id = $1"
	updateContent  = "UPDATE core.content SET parent_id = $2, \"order\" = $3, type = $4, attrs = $5, marks = $6, text = $7 WHERE id = $8 AND doc_id = $1"
	deleteContent  = "DELETE FROM core.content WHERE id = $1 AND doc_id = $2"
	updateDocQuery = "UPDATE core.page_doc_map SET title = $1, version = $2 WHERE doc_id = $3 AND page_id = $4"
	getDocument    = `SELECT 
							d.title AS title, d.owner_id AS ownerId, d.page_id id, d.doc_id AS docId, p.space_id AS spaceId
						FROM 
							core.page p, core.page_doc_map d
						WHERE 
							p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 0 AND d.owner_id = $3 ORDER BY d.version DESC LIMIT 1`
	getDocumentToEdit = `SELECT 
							d.title AS title, d.owner_id AS ownerId, d.page_id id, d.doc_id AS docId, p.space_id AS spaceId
						FROM 
							core.page p, core.page_doc_map d
						WHERE 
							p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 1 AND d.owner_id = $3 ORDER BY d.version DESC LIMIT 1`
	getDocumentNodes = `SELECT 
							c.doc_id AS docId, 
							c.id AS contentId, 
							c.parent_id AS parentId, 
							c.order AS orderId, 
							c.type AS type, 
							c.attrs AS attrs, 
							c.marks AS marks, 
							c.text AS text 
						FROM 
							core.content c
						WHERE c.doc_id = $1`
	updateDraftDocument = `INSERT INTO core.content_draft (doc_id, data) VALUES ($1, $2)`
	getDraftDocument    = `SELECT id, doc_id, data FROM core.content_draft cd WHERE cd.doc_id = $1`
)

func logger() *zap.Logger {
	return core.Logger
}

func (c ContentDraft) Create(conn pgx.Tx, ctx context.Context) (int64, error) {
	var docId int64
	err := conn.QueryRow(ctx, updateDraftDocument, c.DocId, c.Data).Scan(&docId)
	if err != nil {
		logger().Error(err.Error())
		return int64(0), err
	}
	return docId, nil
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

func (d Doc) Update(conn pgx.Tx, ctx context.Context) (int64, error) {
	tag, err := conn.Exec(ctx, updateDocQuery, d.Title, d.Version, d.DocId, d.PageId)
	affected := tag.RowsAffected()
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating doc %v \n", err.Error())
		return int64(0), err
		// conn.Rollback(ctx)
	}
	return affected, nil
}

func fetchDocument(conn pgx.Tx, ctx context.Context, pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (Document, error) {
	var doc Document
	row, err := conn.Query(ctx, getDocument, spaceId, pageId, ownerId)
	if err != nil {
		fmt.Println(err.Error())
		return doc, err
	}
	doc, err = pgx.CollectExactlyOneRow[Document](row, pgx.RowToStructByNameLax[Document])
	if err != nil {
		fmt.Printf("Error happend while fetching document %v \n", err.Error())
		return doc, err
	}
	return doc, err
}

func fetchDocumentToEdit(conn pgx.Tx, ctx context.Context, pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (Document, error) {
	var doc Document
	row, err := conn.Query(ctx, getDocumentToEdit, spaceId, pageId, ownerId)
	if err != nil {
		fmt.Println(err.Error())
		return doc, err
	}
	doc, err = pgx.CollectExactlyOneRow[Document](row, pgx.RowToStructByNameLax[Document])
	if err != nil {
		fmt.Printf("Error happend while fetching document %v \n", err.Error())
		return doc, err
	}
	return doc, err
}

func fetchContent(conn pgx.Tx, ctx context.Context, docId int64) ([]ContentNode, error) {
	var nodes []ContentNode
	rows, err := conn.Query(ctx, getDocumentNodes, docId)
	if err != nil {
		fmt.Println(err.Error())
		return nodes, err
	}
	nodes, err = pgx.CollectRows(rows, pgx.RowToStructByNameLax[ContentNode])
	if err != nil {
		fmt.Println(err)
		fmt.Printf("Error happend while fetching nodes %v \n", err.Error())
		return nodes, err
	}
	return nodes, err
}

func fetchContentToEdit(conn pgx.Tx, ctx context.Context, docId int64) (ContentDraft, error) {
	var nodes ContentDraft
	rows, err := conn.Query(ctx, getDraftDocument, docId)
	if err != nil {
		fmt.Println(err.Error())
		return nodes, err
	}
	nodes, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[ContentDraft])
	if errors.Is(err, pgx.ErrNoRows) {
		return nodes, nil
	}
	if err != nil {
		fmt.Println(err)
		fmt.Printf("Error happend while fetching nodes %v \n", err.Error())
		return nodes, err
	}
	return nodes, err
}

func (d Doc) Publish() int64 {
	return int64(0)
}

func (d Doc) Delete() int64 {
	return int64(0)
}

func nullifyIfZeroUUID(id uuid.UUID) interface{} {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func (c ContentNode) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var docId uuid.UUID
	err := conn.QueryRow(ctx, newContent, c.ContentId, c.DocId, nullifyIfZeroUUID(c.ParentId), c.OrderId, c.Type, c.Attributes, c.Marks, c.Text).Scan(&docId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating Content %v \n", err.Error())
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return docId, nil
}

func (c ContentNode) Update(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var docId uuid.UUID
	_, err := conn.Exec(ctx, updateContent, c.DocId, nullifyIfZeroUUID(c.ParentId), c.OrderId, c.Type, c.Attributes, c.Marks, c.Text, c.ContentId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating Content %v \n", err.Error())
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return docId, nil
}

func (c ContentNode) Publish() int64 {
	return int64(0)
}

func (c ContentNode) Delete(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var docId uuid.UUID
	_, err := conn.Exec(ctx, deleteContent, c.ContentId, c.DocId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating Content %v \n", err.Error())
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return docId, nil
}

// returns space object for given space id
func GetSpace(id uuid.UUID) Space {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		panic("Unable to acquire a connection: " + err.Error())
	}
	var space Space
	row := conn.QueryRow(ctx, getSpace, id)
	err = row.Scan(&space.Id, &space.Name, &space.DateCreated, &space.DateUpdate, &space.UserId)
	if err != nil {
		fmt.Println(err.Error())
	}
	return space
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
	doc := Doc{PageId: pageId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 1}
	_, err = doc.Create(tx, ctx)
	if err != nil {
		return pageId, err
	}
	tx.Commit(ctx)
	// return created page id
	return pageId, nil
}

func (document InputDocument) Publish() (int64, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	// // create page
	// page := Page{SpaceId: document.SpaceId, OwnerId: document.OwnerId, ParentId: document.ParentId, DateCreated: time.Now(), Status: 0}
	// pageId, err := page.Create(tx, ctx)
	// if err != nil {
	// 	return pageId, err
	// }
	// create or update doc
	// we need to create a doc if there is none exists in draft state
	// we need to update a doc if exists in draft state
	doc := Doc{PageId: document.Id, DocId: document.DocId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 0}
	_, err = doc.Update(tx, ctx)
	if err != nil {
		return document.Id, err
	}
	// create content
	for _, child := range document.New {
		child.DocId = document.DocId
		_, err := child.Create(tx, ctx)
		if err != nil {
			// return pageId and error
			return document.Id, err
		}
	}
	for _, child := range document.Updated {
		child.DocId = document.DocId
		_, err := child.Update(tx, ctx)
		if err != nil {
			// return pageId and error
			return document.Id, err
		}
	}
	for _, child := range document.Deleted {
		child.DocId = document.DocId
		_, err := child.Delete(tx, ctx)
		if err != nil {
			// return pageId and error
			return document.Id, err
		}
	}
	tx.Commit(ctx)
	// return updated page id
	return document.Id, nil
}

func (document InputDraftDocument) Update() (int64, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	// create or update doc
	// we need to create a doc if there is none exists in draft state
	// we need to update a doc if exists in draft state
	doc := Doc{PageId: document.Id, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 1}
	docId, err := doc.Create(tx, ctx)
	if err != nil {
		return document.Id, err
	}
	ContentDraft := ContentDraft{DocId: docId, Data: document.Data}
	_, err = ContentDraft.Create(tx, ctx)
	if err != nil {
		return document.Id, err
	}
	tx.Commit(ctx)
	// return updated page id
	return document.Id, nil
}

func GetDocument(pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (OutputDocument, error) {
	var outputDocument OutputDocument
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	doc, err := fetchDocument(tx, ctx, pageId, spaceId, ownerId)
	if err != nil {
		return outputDocument, err
	}
	if doc.DocId == 0 { // zero value
		return outputDocument, err
	}
	nodes, err := fetchContent(tx, ctx, doc.DocId)
	if err != nil {
		return outputDocument, err
	}
	outputDocument.Document = doc
	outputDocument.Nodes = append(outputDocument.Nodes, nodes...)
	tx.Commit(ctx)
	return outputDocument, nil
}

func GetDocumentToEdit(pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (OutputDocumentToEdit, error) {
	var outputDocument OutputDocumentToEdit
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	doc, err := fetchDocumentToEdit(tx, ctx, pageId, spaceId, ownerId)
	if err != nil {
		return outputDocument, err
	}
	if doc.DocId == 0 { // zero value
		return outputDocument, err
	}
	nodes, err := fetchContentToEdit(tx, ctx, doc.DocId)
	if err != nil {
		return outputDocument, err
	}
	outputDocument.Document = doc
	outputDocument.Data = nodes
	tx.Commit(ctx)
	return outputDocument, nil
}
