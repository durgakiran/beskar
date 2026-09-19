package core

import (
	"fmt"

	"github.com/google/uuid"
)

// These are content API URLs, not browser routes. Shared discovery APIs remain v1.
type WhiteboardNavigation struct {
	DraftURL     string `json:"draftUrl,omitempty"`
	PublishedURL string `json:"publishedUrl,omitempty"`
	PreviewURL   string `json:"previewUrl,omitempty"`
}

func BuildWhiteboardNavigation(space uuid.UUID, page int64, version int, canEdit bool, published *uuid.UUID, hasPreview bool) *WhiteboardNavigation {
	if version != 2 {
		return nil
	}
	base := fmt.Sprintf("/api/v2/editor/space/%s/whiteboard/%d", space, page)
	nav := &WhiteboardNavigation{}
	if canEdit {
		nav.DraftURL = base + "/draft"
	}
	if published != nil {
		nav.PublishedURL = base + "/published"
		if hasPreview {
			nav.PreviewURL = fmt.Sprintf("%s/published/%s/preview", base, published)
		}
	}
	return nav
}
