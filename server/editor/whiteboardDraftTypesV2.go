package editor

import (
	"context"
	"io"
	"time"

	"github.com/google/uuid"
)

const (
	whiteboardDraftPageBytes     = 4 * 1024 * 1024
	whiteboardDraftPageCount     = 64
	whiteboardSnapshotChunkBytes = 256 * 1024
)

type whiteboardDraftInput struct {
	SpaceID uuid.UUID
	PageID  int64
	ActorID uuid.UUID
}
type whiteboardDraftSnapshot struct {
	ID              uuid.UUID `json:"id"`
	ThroughSequence int64     `json:"throughSequence,string"`
	Title           string    `json:"title"`
	UpdateEncoding  string    `json:"updateEncoding"`
	DownloadURL     string    `json:"downloadUrl"`
	ByteLength      int64     `json:"byteLength"`
	StateDigest     string    `json:"stateDigest"`
}
type whiteboardDraftManifest struct {
	RestoreGeneration int64                   `json:"restoreGeneration,string"`
	Title             string                  `json:"title"`
	PageID            int64                   `json:"pageId"`
	SpaceID           uuid.UUID               `json:"spaceId"`
	HeadSequence      int64                   `json:"headSequence,string"`
	BaseSnapshot      whiteboardDraftSnapshot `json:"baseSnapshot"`
	UpdatesURL        string                  `json:"updatesUrl"`
	ExpiresAt         time.Time               `json:"expiresAt"`
	UpdatedBy         uuid.UUID               `json:"updatedBy"`
	UpdatedAt         time.Time               `json:"updatedAt"`
}
type whiteboardDraftUpdate struct {
	Title          *string `json:"title,omitempty"`
	Sequence       int64   `json:"sequence,string"`
	UpdateEncoding string  `json:"updateEncoding"`
	Update         []byte  `json:"update"`
}
type whiteboardDraftPage struct {
	HeadSequence int64                   `json:"headSequence,string"`
	Updates      []whiteboardDraftUpdate `json:"updates"`
	NextCursor   *string                 `json:"nextCursor"`
	Complete     bool                    `json:"complete"`
}
type whiteboardDraftReplay struct {
	ID, Secret, SnapshotID uuid.UUID
	Base, Head             int64
	ExpiresAt              time.Time
}
type whiteboardSnapshotStream struct {
	Content io.ReadSeekCloser
	Length  int64
	Digest  string
}
type whiteboardDraftReader interface {
	GetDraft(context.Context, whiteboardDraftInput) (whiteboardDraftManifest, error)
	GetDraftUpdates(context.Context, whiteboardDraftInput, string) (whiteboardDraftPage, error)
	OpenDraftSnapshot(context.Context, whiteboardDraftInput, uuid.UUID, uuid.UUID) (whiteboardSnapshotStream, error)
}
