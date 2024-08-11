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

const exampleDoc = `{
        "title": "Hello World updated title",
        "ownerId": "6203346b-242e-4d2a-8cf5-af0818fcc748",
        "parentId": 0,
        "id": 14,
        "docId": 7,
        "spaceId": "f458794c-7127-4ea1-934c-ab44a8c3bfb0",
        "nodeData": {
            "content": [
                {
                    "docId": 7,
                    "parentId": "00000000-0000-0000-0000-000000000000",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "type": "doc",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "82fc01ff-751a-413f-9d61-115347c35f10",
                    "type": "heading",
                    "attrs": {
                        "level": 3,
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "23a85fdd-7c43-40fe-9644-16e0fca665eb",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 2,
                    "contentId": "5409db73-ee2d-4a34-852c-dcce24316e86",
                    "type": "bulletList",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 3,
                    "contentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "type": "noteBlock",
                    "attrs": {
                        "color": "#f3f0ff",
                        "emoji": ":dfnote:"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 4,
                    "contentId": "839d1447-f802-428e-8b67-f15402faf11f",
                    "type": "heading",
                    "attrs": {
                        "level": 3,
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "3ae480ba-be06-46e5-8c59-41f1084240dc",
                    "marks": null,
                    "orderId": 5,
                    "contentId": "cabdd29b-665b-40d4-b659-ec89c78789d1",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "5409db73-ee2d-4a34-852c-dcce24316e86",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "a67b6e55-c107-4cf0-8b58-3545bcb33959",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "5409db73-ee2d-4a34-852c-dcce24316e86",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "d8147270-df65-4cd2-b51f-58abc29e08dc",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "a67b6e55-c107-4cf0-8b58-3545bcb33959",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "46f46cea-1e1b-4287-9caf-63c6a4b018d0",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "a67b6e55-c107-4cf0-8b58-3545bcb33959",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "3ffba2ba-2c07-470c-9ce1-75a28defe48d",
                    "type": "bulletList",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "d8147270-df65-4cd2-b51f-58abc29e08dc",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "f5b3bc1c-d191-4b65-b9ec-a23827df73ff",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "d8147270-df65-4cd2-b51f-58abc29e08dc",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "e0e8f61b-76b7-4201-a91c-028a58fa186c",
                    "type": "bulletList",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "3ffba2ba-2c07-470c-9ce1-75a28defe48d",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "7fdda13b-ef58-44b9-9210-99725e0b7ce6",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "3ffba2ba-2c07-470c-9ce1-75a28defe48d",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "32f5a58d-8416-4500-8bff-1f7a6dc64d8b",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "e0e8f61b-76b7-4201-a91c-028a58fa186c",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "519de424-46ea-4b80-bd86-1c7cbd44fbf7",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "e0e8f61b-76b7-4201-a91c-028a58fa186c",
                    "marks": null,
                    "orderId": 1,
                    "contentId": "fefe45db-612b-41dc-bbd1-09244bd6b885",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "e0e8f61b-76b7-4201-a91c-028a58fa186c",
                    "marks": null,
                    "orderId": 2,
                    "contentId": "eef5a6e5-76a0-472d-b798-3163690b3102",
                    "type": "listItem",
                    "attrs": null
                },
                {
                    "docId": 7,
                    "parentId": "7fdda13b-ef58-44b9-9210-99725e0b7ce6",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "b1e4af5b-8b7f-4903-bc2e-e8916cb68fdc",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "32f5a58d-8416-4500-8bff-1f7a6dc64d8b",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "7f7c767e-b765-43dd-b782-10b28f8b3a9c",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "519de424-46ea-4b80-bd86-1c7cbd44fbf7",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "ff6c67f9-0368-41d0-a0d2-d9aea7769863",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "fefe45db-612b-41dc-bbd1-09244bd6b885",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "129e5e31-55bb-44ef-9206-cfaa8d994dad",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                },
                {
                    "docId": 7,
                    "parentId": "eef5a6e5-76a0-472d-b798-3163690b3102",
                    "marks": null,
                    "orderId": 0,
                    "contentId": "1a3ed14a-38c7-428b-bec9-679fbe139b4e",
                    "type": "paragraph",
                    "attrs": {
                        "textAlign": "left"
                    }
                }
            ],
            "text": [
                {
                    "docId": 7,
                    "parentId": "129e5e31-55bb-44ef-9206-cfaa8d994dad",
                    "marks": null,
                    "orderId": 0,
                    "text": "supports indexing."
                },
                {
                    "docId": 7,
                    "parentId": "1a3ed14a-38c7-428b-bec9-679fbe139b4e",
                    "marks": null,
                    "orderId": 0,
                    "text": "most applications uses jsonb."
                },
                {
                    "docId": 7,
                    "parentId": "23a85fdd-7c43-40fe-9644-16e0fca665eb",
                    "marks": null,
                    "orderId": 0,
                    "text": "There are two type for json data"
                },
                {
                    "docId": 7,
                    "parentId": "46f46cea-1e1b-4287-9caf-63c6a4b018d0",
                    "marks": null,
                    "orderId": 0,
                    "text": "json"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 3,
                    "text": "json"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 4,
                    "text": " type, Unicode escapes are allowed regardless of the database encoding, and are checked only for syntactic correctness (that is, that four hex digits follow "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 5,
                    "text": "\\u"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 6,
                    "text": "). However, the input function for "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 7,
                    "text": "jsonb"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 8,
                    "text": " is stricter: it disallows Unicode escapes for characters that cannot be represented in the database encoding. The "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 9,
                    "text": "jsonb"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 11,
                    "text": "\\u0000"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 12,
                    "text": " (because that cannot be represented in PostgreSQL's "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 13,
                    "text": "text"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 14,
                    "text": " type), and it insists that any use of Unicode surrogate pairs to designate characters outside the Unicode Basic Multilingual Plane be correct. Valid Unicode escapes are converted to the equivalent single character for storage; this includes folding surrogate pairs into a single character."
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 10,
                    "text": " type also rejects "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 0,
                    "text": "RFC 7159 permits JSON strings to contain Unicode escape sequences denoted by "
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": [
                        {
                            "type": "code"
                        }
                    ],
                    "orderId": 1,
                    "text": "\\uXXXX"
                },
                {
                    "docId": 7,
                    "parentId": "61507b59-6a94-4e03-97fb-484a569cfa4f",
                    "marks": null,
                    "orderId": 2,
                    "text": ". In the input function for the "
                },
                {
                    "docId": 7,
                    "parentId": "7f7c767e-b765-43dd-b782-10b28f8b3a9c",
                    "marks": null,
                    "orderId": 0,
                    "text": "insignificant white spaces are preserved while saving"
                },
                {
                    "docId": 7,
                    "parentId": "82fc01ff-751a-413f-9d61-115347c35f10",
                    "marks": null,
                    "orderId": 0,
                    "text": "JSON vs JSONB"
                },
                {
                    "docId": 7,
                    "parentId": "839d1447-f802-428e-8b67-f15402faf11f",
                    "marks": null,
                    "orderId": 0,
                    "text": "How to handle large documents in postgres"
                },
                {
                    "docId": 7,
                    "parentId": "b1e4af5b-8b7f-4903-bc2e-e8916cb68fdc",
                    "marks": null,
                    "orderId": 0,
                    "text": "stores exact copy of input and hence duplicate keys are allowed"
                },
                {
                    "docId": 7,
                    "parentId": "f5b3bc1c-d191-4b65-b9ec-a23827df73ff",
                    "marks": null,
                    "orderId": 0,
                    "text": "jsonb"
                },
                {
                    "docId": 7,
                    "parentId": "ff6c67f9-0368-41d0-a0d2-d9aea7769863",
                    "marks": null,
                    "orderId": 0,
                    "text": "stores decomposed binary format that makes it slightly slower to input due to added conversion overhead."
                }
            ]
        }
    }`

func TestCreateEditorDocument(t *testing.T) {
	t.Run("Validate input Content nodes", func(t *testing.T) {
		var content ContentNode
		err := json.Unmarshal([]byte(contentNode), &content)

		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}

		// contentArray := make([]Content, 0)
		contentNodeArray := make([]ContentNode, 0)
		textNodeArray := make([]TextNode, 0)
		contentNodeArray = append(contentNodeArray, content)
		nodeData := NodeData{Content: contentNodeArray, Text: textNodeArray}
		inputDocument := Doc{DocId: 1, Id: 1, NodeData: nodeData, Title: "Hello World"}
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

		var sampleDoc Doc
		err = json.Unmarshal([]byte(exampleDoc), &sampleDoc)
		if err != nil {
			fmt.Println(err)
			t.Errorf("Failed to unmarhsal doc data")
		}
		out = sampleDoc.CreateEditorDocument()
		if out.Type != "doc" {
			t.Errorf("Expected type of root node to be doc, got %v", out.Type)
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
		inputDocument := Doc{DocId: 1, Id: 1, NodeData: got, Title: "Hello World"}
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

		if out.Content[0].Attributes["contentId"] != uuid.MustParse("20c562a2-8e31-43d0-a94d-1e00653468a1") {
			t.Errorf("Expecting content Id '20c562a2-8e31-43d0-a94d-1e00653468a1' , got %v", out.Content[0].Attributes["contentId"])
		}
	})
}
