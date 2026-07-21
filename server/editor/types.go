package editor

import (
	"time"

	"github.com/durgakiran/beskar/assetref"
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
	Title           string    `json:"title"`
	OwnerId         uuid.UUID `json:"ownerId"`
	ParentId        int64     `json:"parentId"`
	Id              int64     `json:"id"`
	DocId           int64     `json:"docId"`
	SpaceId         uuid.UUID `json:"spaceId"`
	DraftGeneration int64     `json:"draftGeneration,omitempty"`
}

// EditDocumentMeta is a lightweight payload for GET …/edit/meta and page events (draftGeneration idempotency).
type EditDocumentMeta struct {
	DocID           int64     `json:"docId"`
	DraftGeneration int64     `json:"draftGeneration"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Title           string    `json:"title"`
	ParentID        int64     `json:"parentId"`
	Draft           bool      `json:"draft"`
}

type InputDocument struct {
	Document
	Nodes           NodeData                    `json:"nodeData"`
	AssetReferences *assetref.PayloadReferences `json:"assetReferences,omitempty"`
}

type ContentDraft struct {
	Id    int64  `json:"id" db:"id"`
	DocId int64  `json:"docId" db:"doc_id"`
	Data  []byte `json:"data" data:"data"`
}

type InputDraftDocument struct {
	Document
	Data            []byte                      `json:"data"`
	IsDraftLeader   bool                        `json:"isDraftLeader"`
	AssetReferences *assetref.PayloadReferences `json:"assetReferences,omitempty"`
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
	Id               int64     `json:"id"`
	Title            string    `json:"title"`
	SpaceId          uuid.UUID `json:"spaceId"`
	ParentId         int64     `json:"parentId"`
	OwnerId          uuid.UUID `json:"ownerId"`
	Data             []byte    `json:"data"` // base64-decoded Yjs state
	PreviewAssetName string    `json:"previewAssetName,omitempty"`
}

type WhiteboardData struct {
	Id                   int64     `json:"id" db:"id"`
	DocId                int64     `json:"docId" db:"doc_id"`
	Data                 []byte    `json:"data" db:"data"`
	Title                string    `json:"title" db:"title"`
	PageId               int64     `json:"pageId" db:"id"`
	SpaceId              uuid.UUID `json:"spaceId" db:"spaceId"`
	PreviewAssetName     string    `json:"previewAssetName"`
	DurableRevision      string    `json:"durableRevision"`
	StateDigest          string    `json:"stateDigest"`
	ServerUpdateSequence int64     `json:"serverUpdateSequence"`
}

type WhiteboardCheckpointInput struct {
	DraftId             int64     `json:"draftId"`
	Data                []byte    `json:"data"`
	TransactionSequence int64     `json:"transactionSequence"`
	StateDigest         string    `json:"stateDigest"`
	ExpectedRevision    string    `json:"expectedRevision"`
	ClientId            string    `json:"clientId"`
	RequestId           string    `json:"requestId"`
	OwnerId             uuid.UUID `json:"-"`
	PageId              int64     `json:"-"`
	SpaceId             uuid.UUID `json:"-"`
}

type WhiteboardAcknowledgedCheckpoint struct {
	TransactionSequence  int64  `json:"transactionSequence"`
	ServerUpdateSequence int64  `json:"serverUpdateSequence"`
	StateDigest          string `json:"stateDigest"`
}

type WhiteboardCheckpointResult struct {
	DraftId                int64                            `json:"draftId"`
	Revision               string                           `json:"revision"`
	AcknowledgedCheckpoint WhiteboardAcknowledgedCheckpoint `json:"acknowledgedCheckpoint"`
}

type WhiteboardCheckpointConflict struct {
	DraftId              int64  `json:"draftId"`
	Revision             string `json:"revision"`
	StateDigest          string `json:"stateDigest"`
	ServerUpdateSequence int64  `json:"serverUpdateSequence"`
	Data                 []byte `json:"data,omitempty"`
}

type WhiteboardPublishInput struct {
	Id                    int64                            `json:"id"`
	SpaceId               uuid.UUID                        `json:"spaceId"`
	OwnerId               uuid.UUID                        `json:"ownerId"`
	DraftId               int64                            `json:"draftId"`
	Data                  []byte                           `json:"data"`
	PreviewAssetName      string                           `json:"previewAssetName"`
	ExpectedDraftRevision string                           `json:"expectedDraftRevision"`
	Checkpoint            WhiteboardAcknowledgedCheckpoint `json:"checkpoint"`
	ClientId              string                           `json:"clientId"`
	RequestId             string                           `json:"requestId"`
}

type WhiteboardPublishResult struct {
	PublishedDocId int64  `json:"publishedDocId"`
	NextDraftId    int64  `json:"nextDraftId"`
	NextRevision   string `json:"nextRevision"`
}

type WhiteboardVersion struct {
	DocId            int64     `json:"docId"`
	Version          time.Time `json:"version"`
	PreviewAssetName string    `json:"previewAssetName"`
}

type PageMetadata struct {
	Id      int64     `json:"id" db:"id"`
	Type    string    `json:"type" db:"type"`
	SpaceId uuid.UUID `json:"spaceId" db:"spaceId"`
}

type PageInlineLinkMetadata struct {
	PageId           int64     `json:"pageId" db:"id"`
	Type             string    `json:"type" db:"type"`
	SpaceId          uuid.UUID `json:"spaceId" db:"spaceId"`
	Title            string    `json:"title" db:"title"`
	PreviewAssetName string    `json:"previewAssetName"`
}

type ExternalLinkMetadata struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	SiteName string `json:"siteName,omitempty"`
}
