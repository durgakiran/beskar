package core

import "github.com/google/uuid"

type Node struct {
	DocId    int64                    `json:"docId"`
	ParentId uuid.UUID                `json:"parentId"`
	Marks    []map[string]interface{} `json:"marks"`
	OrderId  int64                    `json:"orderId"`
}

type TextNode struct {
	DocId    int64                    `json:"docId"`
	ParentId uuid.UUID                `json:"parentId"`
	Marks    []map[string]interface{} `json:"marks"`
	OrderId  int64                    `json:"orderId"`
	Text     string                   `json:"text"`
}

type ContentNode struct {
	DocId      int64                    `json:"docId"`
	ParentId   uuid.UUID                `json:"parentId"`
	Marks      []map[string]interface{} `json:"marks"`
	OrderId    int64                    `json:"orderId"`
	ContentId  uuid.UUID                `json:"contentId"`
	Type       string                   `json:"type"`
	Attributes map[string]interface{}   `json:"attrs"`
}

type NodeData struct {
	Content []ContentNode `json:"content"`
	Text    []TextNode    `json:"text"`
}

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
	Title    string    `json:"title"`
	OwnerId  uuid.UUID `json:"ownerId"`
	ParentId int64     `json:"parentId"`
	Id       int64     `json:"id"`
	DocId    int64     `json:"docId"`
	SpaceId  uuid.UUID `json:"spaceId"`
	NodeData NodeData  `json:"nodeData"`
}

// represents document object recieved from the editor
type Document struct {
	Type       string                   `json:"type"`
	Content    []Document               `json:"content"`
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
	PageId int64    `json:"pageId"`
	Data   Document `json:"data"`
}

type OutputDocument struct {
	Id     int64    `json:"id"`
	PageId int64    `json:"pageId"`
	Data   NodeData `json:"data"`
}

type InputDocument struct {
	Id     int64     `json:"id"`
	PageId string    `json:"pageId"`
	Data   []Content `json:"data"`
	Title  string    `json:"title"`
}
