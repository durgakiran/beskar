package editor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (c ContentDraft) Create(conn pgx.Tx, ctx context.Context) (int64, error) {
	var docId int64
	err := conn.QueryRow(ctx, insertDraftDocument, c.DocId, c.Data).Scan(&docId)
	if err != nil {
		logger().Error(err.Error())
		return int64(0), err
	}
	return docId, nil
}

func (c ContentDraft) Update(conn pgx.Tx, ctx context.Context) (int64, error) {
	var docId int64
	err := conn.QueryRow(ctx, updateDraftDocument, c.DocId, c.Data).Scan(&docId)
	if err != nil {
		logger().Error(err.Error())
		return int64(0), err
	}
	return docId, nil
}

// delets content draft and returns number of rows affected
func (c ContentDraft) Delete(conn pgx.Tx, ctx context.Context) (int64, error) {
	var rowsAffected int64
	command, err := conn.Exec(ctx, deleteDraftDocument, c.DocId)
	rowsAffected = command.RowsAffected()
	if err != nil {
		logger().Error(err.Error())
		return int64(0), err
	}
	return rowsAffected, nil
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
	tag, err := conn.Exec(ctx, updateDocQuery, d.Title, d.Version, d.DocId, d.PageId, d.Draft)
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
	row, err := conn.Query(ctx, getDocument, spaceId, pageId)
	if err != nil {
		logger().Error(err.Error())
		return doc, err
	}
	doc, err = pgx.CollectExactlyOneRow(row, pgx.RowToStructByNameLax[Document])
	if err != nil {
		fmt.Printf("Error happend while fetching document %v \n", err.Error())
		return doc, err
	}
	return doc, err
}

func fetchDocumentToEdit(conn pgx.Tx, ctx context.Context, pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (Document, error) {
	var doc Document
	row, err := conn.Query(ctx, getDocumentDataToEdit, spaceId, pageId)
	if err != nil {
		logger().Error(err.Error())
		return doc, err
	}
	doc, err = pgx.CollectExactlyOneRow(row, pgx.RowToStructByNameLax[Document])
	if err != nil {
		logger().Error(err.Error())
		fmt.Printf("Error happend while fetching document %v \n", err.Error())
		return doc, err
	}
	return doc, err
}

func fetchContent(conn pgx.Tx, ctx context.Context, docId int64) (NodeData, error) {
	var nodes []ContentNode
	rows, err := conn.Query(ctx, getDocumentNodes, docId)
	if err != nil {
		logger().Error(err.Error())
		return NodeData{}, err
	}
	nodes, err = pgx.CollectRows(rows, pgx.RowToStructByNameLax[ContentNode])
	if err != nil {
		logger().Error(err.Error())
		fmt.Printf("Error happend while fetching nodes %v \n", err.Error())
		return NodeData{}, err
	}
	var textNodes []TextNode
	rows, err = conn.Query(ctx, getTextNodes, docId)
	if err != nil {
		logger().Error(err.Error())
		return NodeData{}, err
	}
	textNodes, err = pgx.CollectRows(rows, pgx.RowToStructByNameLax[TextNode])
	if err != nil {
		logger().Error(err.Error())
		fmt.Printf("Error happend while fetching nodes %v \n", err.Error())
		return NodeData{}, err
	}
	return NodeData{Content: nodes, Text: textNodes}, err
}

func fetchContentToEdit(conn pgx.Tx, ctx context.Context, docId int64) (ContentDraft, error) {
	var nodes ContentDraft
	rows, err := conn.Query(ctx, getDraftDocument, docId)
	if err != nil {
		logger().Error(err.Error())
		return nodes, err
	}
	nodes, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[ContentDraft])
	if errors.Is(err, pgx.ErrNoRows) {
		return nodes, nil
	}
	if err != nil {
		logger().Error(err.Error())
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
	var contentId uuid.UUID
	err := conn.QueryRow(ctx, newContent, c.ContentId, c.DocId, nullifyIfZeroUUID(c.ParentId), c.OrderId, c.Type, c.Attributes, c.Marks).Scan(&contentId)
	if err != nil {
		// error happened we need to cancel whole transaction
		fmt.Printf("Error happened while creating Content %v \n", err.Error())
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return contentId, nil
}

func (c TextNode) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var parentId uuid.UUID
	err := conn.QueryRow(ctx, newText, c.DocId, nullifyIfZeroUUID(c.ParentId), c.OrderId, c.Marks, c.Text).Scan(&parentId)
	if err != nil {
		// error happened we need to cancel whole transaction
		logger().Error(fmt.Sprintf("Error happened while creating Text node %v \n", err.Error()))
		// conn.Rollback(ctx)
		return uuid.Nil, err
	}
	return parentId, nil
}

func (c ContentNode) Update(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var docId uuid.UUID
	_, err := conn.Exec(ctx, updateContent, c.DocId, nullifyIfZeroUUID(c.ParentId), c.OrderId, c.Type, c.Attributes, c.Marks, c.ContentId)
	if err != nil {
		// error happened we need to cancel whole transaction
		logger().Error(fmt.Sprintf("Error happened while creating Content %v \n", err.Error()))
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
		logger().Error(fmt.Sprintf("Error happened while creating Content %v \n", err.Error()))
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
		logger().Error(fmt.Sprintf(err.Error()))
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
	doc := Doc{PageId: pageId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 0}
	_, err = doc.Create(tx, ctx)
	if err != nil {
		return pageId, err
	}
	_, err = core.CreateSubjectPermissions("page", fmt.Sprintf("%v", pageId), "space", document.SpaceId.String(), "space")
	// TODO: use snap token
	if err != nil {
		logger().Error(err.Error())
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
	// create or update doc
	// we need to create a doc if there is none exists in draft state
	// we need to update a doc if exists in draft state
	existingDocument, err := fetchDocumentToEdit(tx, ctx, document.Id, document.SpaceId, document.OwnerId)
	if errors.Is(err, pgx.ErrNoRows) {
		return document.Id, errors.New("nothing new to update")
	}
	if err != nil {
		return document.Id, err
	}
	doc := Doc{PageId: document.Id, DocId: existingDocument.DocId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 0}
	_, err = doc.Update(tx, ctx)
	if err != nil {
		return document.Id, err
	}
	// create content
	for _, child := range document.Nodes.Content {
		child.DocId = existingDocument.DocId
		_, err := child.Create(tx, ctx)
		if err != nil {
			fmt.Println(child.DocId, child.ContentId)
			// return pageId and error
			return document.Id, err
		}
	}
	for _, child := range document.Nodes.Text {
		child.DocId = existingDocument.DocId
		_, err := child.Create(tx, ctx)
		if err != nil {
			// return pageId and error
			return document.Id, err
		}
	}
	// delete drafts for given docId
	draftContent := ContentDraft{DocId: existingDocument.DocId}
	rowsEffected, err := draftContent.Delete(tx, ctx)
	if err != nil {
		return document.Id, err
	}
	logger().Info(fmt.Sprintf("Number rows deleted %v", rowsEffected))
	// for _, child := range document.Updated {
	// 	child.DocId = document.DocId
	// 	_, err := child.Update(tx, ctx)
	// 	if err != nil {
	// 		// return pageId and error
	// 		return document.Id, err
	// 	}
	// }
	// for _, child := range document.Deleted {
	// 	child.DocId = document.DocId
	// 	_, err := child.Delete(tx, ctx)
	// 	if err != nil {
	// 		// return pageId and error
	// 		return document.Id, err
	// 	}
	// }
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
	existingDocument, err := fetchDocumentToEdit(tx, ctx, document.Id, document.SpaceId, document.OwnerId)
	var docId int64
	if errors.Is(err, pgx.ErrNoRows) {
		doc := Doc{PageId: document.Id, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 1}
		docId, err = doc.Create(tx, ctx)
		if err != nil {
			return document.Id, err
		}
	} else if err != nil {
		return document.Id, err
	} else {
		doc := Doc{PageId: document.Id, DocId: existingDocument.DocId, OwnerId: document.OwnerId, Version: time.Now(), Title: document.Title, Draft: 1}
		_, err = doc.Update(tx, ctx)
		if err != nil {
			return document.Id, err
		}
		docId = existingDocument.DocId
	}
	ContentDraft := ContentDraft{DocId: docId, Data: document.Data}
	if existingDocument.DocId != 0 {
		_, err = ContentDraft.Update(tx, ctx)
	} else {
		_, err = ContentDraft.Create(tx, ctx)
	}
	if err != nil {
		return document.Id, err
	}
	tx.Commit(ctx)
	// return updated page id
	return document.Id, nil
}

func GetDocument(pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (OutputDocument, error) {
	var outputDocument OutputDocument
	permissions := core.GetSubjectPermissionList("page", fmt.Sprintf("%v", pageId), "user", ownerId.String())
	fmt.Println(permissions)
	connPool := core.GetPool()
	// TODO: Attach permissions to response
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
	outputDocument.Nodes = nodes
	tx.Commit(ctx)
	return outputDocument, nil
}

// Fetches document either with latest draft data or the latest published document
func GetDocumentToEdit(pageId int64, spaceId uuid.UUID, ownerId uuid.UUID) (OutputDocumentToEdit, error) {
	var outputDocument OutputDocumentToEdit
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	isDraft := true
	defer tx.Rollback(ctx)
	if err != nil {
		panic("Unable to start transaction" + err.Error())
	}
	doc, err := fetchDocumentToEdit(tx, ctx, pageId, spaceId, ownerId)
	if errors.Is(err, pgx.ErrNoRows) {
		doc, err = fetchDocument(tx, ctx, pageId, spaceId, ownerId)
		isDraft = false
	}
	if err != nil {
		return outputDocument, err
	}
	if doc.DocId == 0 { // zero value
		return outputDocument, err
	}
	if isDraft {
		nodes, err := fetchContentToEdit(tx, ctx, doc.DocId)
		if err != nil {
			return outputDocument, err
		}
		outputDocument.Data = nodes
	} else {
		nodes, err := fetchContent(tx, ctx, doc.DocId)
		if err != nil {
			return outputDocument, err
		}
		outputDocument.Nodes = nodes
	}
	outputDocument.Document = doc
	outputDocument.Draft = isDraft
	tx.Commit(ctx)
	return outputDocument, nil
}
