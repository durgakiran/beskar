package editor

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ContentNode struct {
	DocId      int64                  `json:"docId"`
	ContentId  uuid.UUID              `json:"contentId"`
	ParentId   uuid.UUID              `json:"parentId"`
	OrderId    int64                  `json:"orderId"`
	Type       string                 `json:"type"`
	Attributes map[string]interface{} `json:"attrs"`
	Marks      map[string]interface{} `json:"marks"`
	Text       string                 `json:"text"`
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
	Id          uuid.UUID
	Name        string
	DateCreated time.Time
	DateUpdate  time.Time
	UserId      uuid.UUID
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

type InputDocument struct {
	Title    string        `json:"title"`
	OwnerId  uuid.UUID     `json:"owner"`
	ParentId int64         `json:"parentId"`
	SpaceId  uuid.UUID     `json:"spaceId"`
	New      []ContentNode `json:"new"`
	Updated  []ContentNode `json:"updated"`
	Deleted  []ContentNode `json:"deleted"`
}

type Sequence interface {
	GenerateNextVal() interface{}
}
