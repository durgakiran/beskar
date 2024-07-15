package core

import "github.com/google/uuid"

type Content struct {
	DocId      int64                    `json:"docId"`
	ContentId  uuid.UUID                `json:"contentId"`
	ParentId   uuid.UUID                `json:"parentId"`
	OrderId    int64                    `json:"orderId"`
	Type       string                   `json:"type"`
	Attributes map[string]interface{}   `json:"attrs"`
	Marks      []map[string]interface{} `json:"marks"`
	Text       string                   `json:"text"`
}

type Doc struct {
	DocId          int64
	PageId         string
	OwnerId        uuid.UUID
	CurrentVersion int64
	Title          string
	Draft          int8
	Data           []Content
}

// represents document object recieved from the editor
type Document struct {
	Type       string                   `json:"type"`
	Content    []Document               `json:"Content"`
	Attributes map[string]interface{}   `json:"attrs"`
	Marks      []map[string]interface{} `json:"marks"`
	Text       string                   `json:"text"`
}

type Editor interface {
	ConvertToContentObjects() []Content
}

type QueueNode struct {
	value  Document
	Order  int64
	next   *QueueNode
	Parent uuid.UUID
}

type Queue struct {
	front *QueueNode
	back  *QueueNode
}

type QueueOperations interface {
	Enqueue(v Document)
	Dequeue() *QueueNode
	Empty() bool
}

type EditorDocument struct {
	Id     int64    `json:"id"`
	PageId string   `json:"pageId"`
	Data   Document `json:"data"`
}

type OutputDocument struct {
	Id     int64     `json:"id"`
	PageId string    `json:"pageId"`
	Data   []Content `json:"data"`
}

type InputDocument struct {
	Id     int64     `json:"id"`
	PageId string    `json:"pageId"`
	Data   []Content `json:"data"`
	Title  string    `json:"title"`
}
