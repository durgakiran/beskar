package core

import (
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestWhiteboardNavigation(t *testing.T) {
	space, version := uuid.New(), uuid.New()
	if BuildWhiteboardNavigation(space, 42, 1, true, &version, true) != nil {
		t.Fatal("legacy content got v2 URLs")
	}
	draft := BuildWhiteboardNavigation(space, 42, 2, true, nil, false)
	if draft.DraftURL == "" || draft.PublishedURL != "" || draft.PreviewURL != "" {
		t.Fatal("unpublished navigation")
	}
	view := BuildWhiteboardNavigation(space, 42, 2, false, &version, true)
	if view.DraftURL != "" || !strings.HasSuffix(view.PublishedURL, "/published") || !strings.Contains(view.PreviewURL, version.String()) {
		t.Fatal("viewer navigation")
	}
	if BuildWhiteboardNavigation(space, 42, 2, false, &version, false).PreviewURL != "" {
		t.Fatal("missing preview advertised")
	}
}
