package editor

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Node struct {
	DocId    int64                    `json:"docId" db:"docId"`
	ParentId uuid.UUID                `json:"parentId" db:"parentId"`
	Marks    []map[string]interface{} `json:"marks" db:"marks"`
	OrderId  int64                    `json:"orderId" db:"order"`
}

type TextNode struct {
	Node
	Text string `json:"text" db:"text"`
}

type ContentNode struct {
	Node
	ContentId  uuid.UUID              `json:"contentId" db:"contentid"`
	Type       string                 `json:"type" db:"type"`
	Attributes map[string]interface{} `json:"attrs" db:"attrs"`
}

type NodeData struct {
	Content []ContentNode `json:"content"`
	Text    []TextNode    `json:"text"`
}

type Doc struct {
	DocId   int64
	PageId  int64
	OwnerId uuid.UUID
	Version time.Time
	Title   string
	Draft   int8
}

type Page struct {
	Id          int64
	Draft       int8 // reduntant
	SpaceId     uuid.UUID
	OwnerId     uuid.UUID
	ParentId    int64
	DateCreated time.Time
	Status      int8
}

type Space struct {
	Id          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	DateCreated time.Time `json:"dateCreated"`
	DateUpdate  time.Time `json:"dateUpdated"`
	UserId      uuid.UUID `json:"userId"`
}

type Editor interface {
	// creates new page
	Create(conn *pgx.Tx) int64
	// creates new draft of page
	Update() int64
	// publishes new version of page
	Publish() int64
	// delete page
	Delete() int64
}

type Document struct {
	Title    string    `json:"title"`
	OwnerId  uuid.UUID `json:"ownerId"`
	ParentId int64     `json:"parentId"`
	Id       int64     `json:"id"`
	DocId    int64     `json:"docId"`
	SpaceId  uuid.UUID `json:"spaceId"`
}

type InputDocument struct {
	Document
	Nodes NodeData `json:"nodeData"`
}

type ContentDraft struct {
	Id    int64  `json:"id" db:"id"`
	DocId int64  `json:"docId" db:"doc_id"`
	Data  []byte `json:"data" data:"data"`
}

type InputDraftDocument struct {
	Document
	Data []byte `json:"data"`
}

type OutputDocument struct {
	Document
	Nodes NodeData `json:"nodeData"`
}

type OutputDocumentToEdit struct {
	Document
	Data  ContentDraft `json:"data"`
	Draft bool         `json:"draft"`
	Nodes NodeData     `json:"nodeData"`
}

type Sequence interface {
	GenerateNextVal() interface{}
}
