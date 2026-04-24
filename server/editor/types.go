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

type ViewBreadcrumb struct {
	Id    int64   `json:"id"`
	Title string  `json:"title"`
	Href  *string `json:"href"`
}

type ViewSpaceSummary struct {
	Name       string     `json:"name"`
	ArchivedAt *time.Time `json:"archivedAt"`
}

type ViewCapabilities struct {
	CanEdit    bool `json:"canEdit"`
	CanDelete  bool `json:"canDelete"`
	CanComment bool `json:"canComment"`
	CanShare   bool `json:"canShare"`
}

type ViewMeta struct {
	CreatedByName *string    `json:"createdByName,omitempty"`
	UpdatedByName *string    `json:"updatedByName,omitempty"`
	UpdatedAt     *time.Time `json:"updatedAt,omitempty"`
	PublishedAt   *time.Time `json:"publishedAt,omitempty"`
}

type ViewAttachment struct {
	AttachmentID string `json:"attachmentId"`
	FileName     string `json:"fileName"`
	FileSize     int64  `json:"fileSize"`
	FileType     string `json:"fileType"`
	FileURL      string `json:"fileUrl"`
}

type OutputDocumentView struct {
	PageID       int64            `json:"pageId"`
	SpaceID      uuid.UUID        `json:"spaceId"`
	PageType     string           `json:"pageType"`
	Title        string           `json:"title"`
	Document     *OutputDocument  `json:"document"`
	Breadcrumbs  []ViewBreadcrumb `json:"breadcrumbs"`
	Space        ViewSpaceSummary `json:"space"`
	Capabilities ViewCapabilities `json:"capabilities"`
	Meta         ViewMeta         `json:"meta"`
	Attachments  []ViewAttachment `json:"attachments"`
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

type WhiteboardInput struct {
	Id       int64     `json:"id"`
	Title    string    `json:"title"`
	SpaceId  uuid.UUID `json:"spaceId"`
	ParentId int64     `json:"parentId"`
	OwnerId  uuid.UUID `json:"ownerId"`
	Data     []byte    `json:"data"` // base64-decoded Yjs state
}

type WhiteboardData struct {
	Id      int64     `json:"id" db:"id"`
	DocId   int64     `json:"docId" db:"doc_id"`
	Data    []byte    `json:"data" db:"data"`
	Title   string    `json:"title" db:"title"`
	PageId  int64     `json:"pageId" db:"id"`
	SpaceId uuid.UUID `json:"spaceId" db:"spaceId"`
}

type PageMetadata struct {
	Id      int64     `json:"id" db:"id"`
	Type    string    `json:"type" db:"type"`
	SpaceId uuid.UUID `json:"spaceId" db:"spaceId"`
}

type PageInlineLinkMetadata struct {
	PageId  int64     `json:"pageId" db:"id"`
	Type    string    `json:"type" db:"type"`
	SpaceId uuid.UUID `json:"spaceId" db:"spaceId"`
	Title   string    `json:"title" db:"title"`
}

type ExternalLinkMetadata struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	SiteName string `json:"siteName,omitempty"`
}
