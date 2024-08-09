package core

import (
	"fmt"
	"reflect"

	"github.com/google/uuid"
)

type ContentState int

const (
	UPDATED ContentState = iota + 1
	INSERTED
	DELETED
	UNCHANGED
)

func (c ContentState) String() string {
	return [...]string{"UPDATED", "INSERTED", "DELETED", "UNCHANGED"}[c-1]
}

func (c ContentState) EnumIndex() int {
	return int(c)
}

// Traverses Document object from editor to DB node object
func (r Document) ConvertToContentObjects(docId int64) NodeData {
	content := make([]Content, 0)
	textNode := make([]TextNode, 0)
	contentNode := make([]ContentNode, 0)
	queue := Queue{}
	queue.Enqueue(r, 0, uuid.Nil)

	for !queue.Empty() {
		currentNode := queue.Dequeue()
		if currentNode == nil {
			break
		}
		contentObject := Content{}
		contentObject.Attributes = currentNode.value.Attributes
		contentObject.Marks = currentNode.value.Marks
		contentObject.Type = currentNode.value.Type
		contentObject.Text = currentNode.value.Text
		contentObject.OrderId = int64(currentNode.Order)
		contentObject.DocId = docId
		if val, ok := currentNode.value.Attributes["contentId"]; ok && val != uuid.Nil {
			if valueType, ok := val.(string); ok {
				contentObject.ContentId = uuid.MustParse(valueType)
			} else {
				panic(fmt.Errorf("wrong type of content id %v", valueType))
			}
		} else {
			contentObject.ContentId = uuid.New()
		}
		contentObject.ParentId = currentNode.Parent
		contentObject.OrderId = currentNode.Order
		content = append(content, contentObject)

		if contentObject.Type == "text" {
			node := TextNode{
				Text:     contentObject.Text,
				DocId:    contentObject.DocId,
				ParentId: contentObject.ParentId,
				Marks:    contentObject.Marks,
				OrderId:  contentObject.OrderId,
			}
			textNode = append(textNode, node)
		} else {
			node := ContentNode{
				DocId:      contentObject.DocId,
				ParentId:   contentObject.ParentId,
				Marks:      contentObject.Marks,
				OrderId:    contentObject.OrderId,
				Attributes: contentObject.Attributes,
				ContentId:  contentObject.ContentId,
				Type:       contentObject.Type,
			}
			contentNode = append(contentNode, node)
		}

		// add child objects to queue
		for order, child := range currentNode.value.Content {
			queue.Enqueue(child, int64(order), contentObject.ContentId)
		}
	}

	return NodeData{Content: contentNode, Text: textNode}
}

// compares two Content type structs, returns updated state
func CompareContentObjects(original Content, new Content) string {
	if !reflect.DeepEqual(new, original) {
		return UPDATED.String()
	}

	return UNCHANGED.String()
}

// Given original document and updated document we need to find the difference
// in terms of which all nodes got updated, which all got deleted, which all are newly added.
// We need to return all those objects
// func (original EditorDocument) GetChanges(new EditorDocument) ([]Content, []Content, []Content) {
// 	deleted := make([]Content, 0)
// 	inserted := make([]Content, 0)
// 	updated := make([]Content, 0)
// 	oldContent := original.Data.ConvertToContentObjects(original.Id)
// 	fmt.Println(oldContent)
// 	newContent := new.Data.ConvertToContentObjects(new.Id)

// 	// create map to compare
// 	oldContentMap := make(map[uuid.UUID]Content)
// 	newContentMap := make(map[uuid.UUID]Content)
// 	for _, content := range newContent {
// 		newContentMap[content.ContentId] = content
// 	}

// 	for _, content := range oldContent {
// 		if _, ok := newContentMap[content.ContentId]; !ok {
// 			deleted = append(deleted, content)
// 		} else {
// 			oldContentMap[content.ContentId] = content
// 		}
// 	}

// 	for _, content := range newContent {
// 		if val, ok := oldContentMap[content.ContentId]; ok {
// 			fmt.Println(val, content)
// 			if res := CompareContentObjects(val, content); res == UPDATED.String() {
// 				updated = append(updated, content)
// 			}
// 		} else {
// 			inserted = append(inserted, content)
// 		}
// 	}

// 	return deleted, inserted, updated
// }
