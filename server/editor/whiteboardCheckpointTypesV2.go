package editor

import "github.com/google/uuid"

const (
	whiteboardCheckpointV2MaxBody   = 1536 * 1024
	whiteboardCheckpointV2MaxUpdate = 1024 * 1024
	whiteboardUpdateEncodingV1      = "yjs-update-v1"
)

type whiteboardCheckpointV2Body struct {
	RestoreGeneration string  `json:"restoreGeneration,omitempty"`
	Title             *string `json:"title,omitempty"`
	UpdateEncoding    string  `json:"updateEncoding"`
	Update            string  `json:"update"`
}
type whiteboardCheckpointV2Input struct {
	RestoreGeneration int64
	Title             *string
	PageID            int64
	SpaceID           uuid.UUID
	ActorID           uuid.UUID
	IdempotencyKey    uuid.UUID
	UpdateEncoding    string
	UpdateBytes       []byte
}
type whiteboardCheckpointV2Result struct {
	PageID   int64     `json:"pageId"`
	UpdateID uuid.UUID `json:"updateId"`
	Sequence int64     `json:"sequence,string"`
}
