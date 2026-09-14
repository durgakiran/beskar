package editor

import (
	"github.com/google/uuid"
)

type whiteboardCreateV2Body struct {
	Title    string `json:"title"`
	ParentID *int64 `json:"parentId"`
}

type whiteboardCreateV2Input struct {
	whiteboardCreateV2Body
	SpaceID        uuid.UUID
	ActorID        uuid.UUID
	IdempotencyKey uuid.UUID
}

type whiteboardCreateV2Result struct {
	PageID  int64     `json:"pageId"`
	SpaceID uuid.UUID `json:"spaceId"`
}
