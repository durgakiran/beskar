package core

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

const contentNode = `{
	"docId": 1,
	"contentId": "20c562a2-8e31-43d0-a94d-1e00653468a1",
	"orderId": 0,
	"type": "doc"
}`

func TestCreateEditorDocument(t *testing.T) {
	t.Run("Validate input Content nodes", func(t *testing.T) {
		var content Content
		err := json.Unmarshal([]byte(contentNode), &content)

		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}

		contentArray := make([]Content, 0)
		contentArray = append(contentArray, content)
		inputDocument := Doc{DocId: 1, PageId: "1", Data: contentArray, Title: "Hello World"}
		out := inputDocument.CreateEditorDocument()

		if out.Type != "doc" {
			t.Errorf("Expected type of root node to be doc, got %v", out.Type)
		}

		if out.Attributes["contentId"] != uuid.MustParse("20c562a2-8e31-43d0-a94d-1e00653468a1") {
			t.Errorf("Expected proper content id, got %v", out.Attributes)
		}

		if out.Attributes["orderId"] != int64(0) {
			t.Errorf("Expected proper order id, got %v", out.Attributes)
		}

		if out.Attributes["docId"] != int64(1) {
			t.Errorf("Expected proper doc id, got %v", out.Attributes)
		}

		if len(out.Content) != 0 {
			t.Errorf("Expected there are no children for root doc")
		}
	})

	t.Run("Validate nested document", func(t *testing.T) {
		doc := Document{}
		err := json.Unmarshal([]byte(originalData), &doc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		got := doc.ConvertToContentObjects(1)
		inputDocument := Doc{DocId: 1, PageId: "1", Data: got, Title: "Hello World"}
		out := inputDocument.CreateEditorDocument()

		if len(out.Content) != 2 {
			t.Errorf("Must have 2 children for root object, got %v", len(out.Content))
		}

		if len(out.Content[0].Content) != 1 {
			t.Errorf("Must have 1 children for first child object, got %v", len(out.Content[0].Content))
		}

		if out.Text != "" {
			t.Errorf("Root must have empty string, got %v", out.Text)
		}

		if out.Content[0].Content[0].Text != "This is first document" {
			t.Errorf("Expecting string 'This is first document' , got %v", out.Content[0].Content[0].Text)
		}

		if out.Content[0].Content[0].Attributes["contentId"] != uuid.MustParse("0df31691-c281-4745-b271-bf75b83629ae") {
			t.Errorf("Expecting content Id '0df31691-c281-4745-b271-bf75b83629ae' , got %v", out.Content[0].Content[0].Attributes["contentId"])
		}
	})
}
