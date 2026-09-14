package editor

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type whiteboardPublishInput struct {
	whiteboardDraftInput
	PreviewPNG     []byte
	Sequence       int64
	IdempotencyKey uuid.UUID
}
type whiteboardPublishedManifest struct {
	PageID        int64                      `json:"pageId"`
	SpaceID       uuid.UUID                  `json:"spaceId"`
	VersionID     uuid.UUID                  `json:"versionId"`
	VersionNumber int64                      `json:"versionNumber,string"`
	PublishedBy   uuid.UUID                  `json:"publishedBy"`
	PublishedAt   time.Time                  `json:"publishedAt"`
	Snapshot      whiteboardDraftSnapshot    `json:"snapshot"`
	Preview       *whiteboardPreviewMetadata `json:"preview"`
}
type whiteboardPublisherV2 interface {
	GetPublishedPreview(context.Context, whiteboardDraftInput) (whiteboardPreview, error)
	GetVersionPreview(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardPreview, error)
	PublishWhiteboard(context.Context, whiteboardPublishInput) (whiteboardPublishedManifest, error)
	GetPublishedWhiteboard(context.Context, whiteboardDraftInput) (whiteboardPublishedManifest, error)
	OpenPublishedSnapshot(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardSnapshotStream, error)
}
type whiteboardMaterialized struct {
	State []byte `json:"state"`
	Title string `json:"title"`
}
