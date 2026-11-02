package editor

import (
	"testing"

	"github.com/durgakiran/beskar/internal/testutil"
	"github.com/google/uuid"
)

func TestDocumentNodeLoadingPostgres(t *testing.T) {
	ctx, tx, spaceID, ownerID, rootID := testutil.DocumentNodes(t)
	// Exercise the same metadata and content queries used by document viewing
	// and the published-document fallback when opening the editor.
	doc, err := fetchDocument(tx, ctx, 1, spaceID, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.DocId != 10 || doc.Id != 1 || doc.SpaceId != spaceID || doc.Title != "Published document" {
		t.Fatalf("unexpected document: %+v", doc)
	}
	nodes, err := fetchContent(tx, ctx, doc.DocId)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes.Content) != 2 || len(nodes.Text) != 1 {
		t.Fatalf("unexpected nodes: %+v", nodes)
	}
	for _, node := range nodes.Content {
		if node.DocId != doc.DocId || node.ContentId == uuid.Nil {
			t.Fatalf("lost content identity: %+v", node)
		}
		if node.ContentId == rootID {
			if node.ParentId != uuid.Nil || node.OrderId != 0 || node.Type != "paragraph" {
				t.Fatalf("unexpected root node: %+v", node)
			}
		} else if node.ParentId != rootID || node.OrderId != 1 || node.Type != "imageBlock" || node.Attributes["src"] != "/media/image/test-image.png" {
			t.Fatalf("lost nested image data: %+v", node)
		}
	}
	text := nodes.Text[0]
	if text.DocId != doc.DocId || text.ParentId != rootID || text.OrderId != 0 || text.Text != "Nested text" || len(text.Marks) != 1 || text.Marks[0]["type"] != "bold" {
		t.Fatalf("lost text data: %+v", text)
	}
	empty, err := fetchContent(tx, ctx, 999)
	if err != nil || len(empty.Content) != 0 || len(empty.Text) != 0 {
		t.Fatalf("empty document: %+v, error: %v", empty, err)
	}
}
