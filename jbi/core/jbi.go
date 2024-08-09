package core

import (
	"sort"

	"github.com/google/uuid"
)

func (t TextNode) craeteTextNode() Document {
	var attributes map[string]interface{} = make(map[string]interface{})
	attributes["orderId"] = t.OrderId
	attributes["docId"] = t.DocId

	return Document{
		Type:       "text",
		Attributes: attributes,
		Marks:      t.Marks,
		Text:       t.Text,
	}
}

func (c ContentNode) createDocumentNode(textNodes []TextNode) Document {

	if len(c.Attributes) == 0 {
		// empty attributs
		c.Attributes = make(map[string]interface{})
	}
	c.Attributes["contentId"] = c.ContentId
	c.Attributes["orderId"] = c.OrderId
	c.Attributes["docId"] = c.DocId

	childeNodes := make([]Document, 0)
	for _, textNode := range textNodes {
		node := textNode.craeteTextNode()
		childeNodes = append(childeNodes, node)
	}

	document := Document{
		Type:       c.Type,
		Attributes: c.Attributes,
		Marks:      c.Marks,
		Text:       "",
		Content:    make([]Document, 0),
	}

	document.Content = append(document.Content, childeNodes...)
	return document
}

func recursiveContentTree(id uuid.UUID, idToContentMap map[uuid.UUID]ContentNode, idToChildMap map[uuid.UUID][]uuid.UUID, idToTextNodeMap map[uuid.UUID][]TextNode) Document {
	if content, ok := idToContentMap[id]; ok {
		childIds := idToChildMap[id]
		doc := content.createDocumentNode(idToTextNodeMap[id])
		childDocumentList := make([]Document, len(childIds))
		sort.Slice(childIds, func(i, j int) bool {
			return idToContentMap[childIds[i]].OrderId < idToContentMap[childIds[j]].OrderId
		})
		for i, childId := range childIds {
			doc := recursiveContentTree(childId, idToContentMap, idToChildMap, idToTextNodeMap)
			childDocumentList[i] = doc
		}
		doc.Content = append(doc.Content, childDocumentList...)
		return doc
	} else {
		panic("No element exist in provided map")
	}
}

// Given Content object construct editor json
func (i Doc) CreateEditorDocument() Document {
	data := i.NodeData
	idToContentMap := make(map[uuid.UUID]ContentNode)
	idToChildIdMap := make(map[uuid.UUID][]uuid.UUID)
	idToTextNodeMap := make(map[uuid.UUID][]TextNode)

	for _, textNode := range data.Text {
		if _, ok := idToTextNodeMap[textNode.ParentId]; !ok {
			idToTextNodeMap[textNode.ParentId] = make([]TextNode, 0)
		}
		idToTextNodeMap[textNode.ParentId] = append(idToTextNodeMap[textNode.ParentId], textNode)
	}

	var rootId uuid.UUID
	for _, child := range data.Content {
		if child.ParentId != uuid.Nil {
			if _, ok := idToChildIdMap[child.ParentId]; !ok {
				idToChildIdMap[child.ParentId] = make([]uuid.UUID, 0)
			}
			idToChildIdMap[child.ParentId] = append(idToChildIdMap[child.ParentId], child.ContentId)
		} else {
			// root node
			rootId = child.ContentId
		}
		idToContentMap[child.ContentId] = child
	}

	doc := recursiveContentTree(rootId, idToContentMap, idToChildIdMap, idToTextNodeMap)

	return doc
}

// import (
// 	"errors"
// 	"fmt"
// )

// type ContentNode struct {
// 	DocId      int64                  `json:"docId"`
// 	ContentId  int64                  `json:"contentId"`
// 	ParentId   int64                  `json:"parentId"`
// 	OrderId    int64                  `json:"orderId"`
// 	Type       string                 `json:"type"`
// 	Attributes map[string]interface{} `json:"attrs"`
// 	Marks      map[string]interface{} `json:"marks"`
// 	Text       string                 `json:"text"`
// }

// type SDocument struct {
// 	Type  string
// 	DocId int64
// 	Value map[int64]ContentNode
// }

// type Document struct {
// 	Type       string                 `json:"type"`
// 	Content    []Document             `json:"Content"`
// 	Attributes map[string]interface{} `json:"attrs"`
// 	Marks      map[string]interface{} `json:"marks"`
// 	Text       string                 `json:"text"`
// }

// type QueueNode struct {
// 	value Document
// 	next  *QueueNode
// }
// type Queue struct {
// 	front *QueueNode
// 	back  *QueueNode
// }

// func (q *Queue) Enqueue(value Document) {
// 	newNode := &QueueNode{value, nil}
// 	if q.front == nil {
// 		q.front = newNode
// 		q.back = newNode
// 	} else {
// 		q.back.next = newNode
// 		q.back = newNode
// 	}
// }

// func (q *Queue) Dequeue() (Document, error) {
// 	if q.front == nil {
// 		return Document{}, errors.New("Queue is empty")
// 	}
// 	val := q.front.value
// 	q.front = q.front.next
// 	return val, nil
// }

// func TraverseJSON(root Document) {
// 	queue := Queue{}
// 	queue.Enqueue(root)
// 	for queue.front != nil {
// 		currentNode, err := queue.Dequeue()
// 		if err != nil {
// 			fmt.Println(err)
// 			return
// 		}
// 		fmt.Println("type: ", currentNode.Type, "text: ", currentNode.Text)
// 		attrsMapLen := len(currentNode.Attributes)
// 		// order
// 		// contentId
// 		// parentId
// 		if attrsMapLen > 0 {
// 			fmt.Println("=== Attributes ===")
// 			for k, v := range currentNode.Attributes {
// 				fmt.Println(k, ": ", v)
// 			}
// 		}
// 		fmt.Println("==== ****** ====")
// 		children := currentNode.Content
// 		if children != nil {
// 			for _, child := range currentNode.Content {
// 				// update order of children
// 				queue.Enqueue(child)
// 			}
// 		}
// 	}
// }

// func TraveseDBDoc(doc []ContentNode) SDocument {
// 	sDocument := SDocument{}
// 	cMap := make(map[int64]ContentNode)
// 	for _, block := range doc {
// 		if block.Type == "doc" {
// 			// root block
// 			sDocument.Type = "doc"
// 			sDocument.DocId = block.DocId
// 		} else {
// 			fmt.Println("blockId: ", block.ContentId)
// 			cMap[block.ContentId] = block
// 		}
// 	}
// 	sDocument.Value = cMap
// 	return sDocument
// }

// func (source *ContentNode) Validate(target ContentNode) bool {
// 	if source.Type != target.Type {
// 		return false
// 	}

// 	if source.Text != target.Text {
// 		return false
// 	}

// 	if source.OrderId != target.OrderId {
// 		return false
// 	}

// 	if source.ParentId != target.ParentId {
// 		return false
// 	}
// 	if attrsMapLen := len(target.Attributes); attrsMapLen > 0 {
// 		for k, v := range target.Attributes {
// 			if k == "orderId" || k == "docId" || k == "parentId" || k == "contentId" {
// 				continue
// 			}
// 			if sourceValue, ok := source.Attributes[k]; ok {
// 				if sourceValue != v {
// 					return false
// 				}
// 			}
// 		}
// 	}
// 	if marksMapLen := len(target.Marks); marksMapLen > 0 {
// 		for k, v := range target.Marks {
// 			if sourceValue, ok := source.Marks[k]; ok {
// 				if sourceValue != v {
// 					return false
// 				}
// 			}
// 		}
// 	}
// 	return true
// }

// func (s *SDocument) ValidateDocument(root Document) {
// 	queue := Queue{}
// 	queue.Enqueue(root)
// 	for queue.front != nil {
// 		currentNode, err := queue.Dequeue()
// 		if err != nil {
// 			fmt.Println(err)
// 			return
// 		}
// 		contentNode := ContentNode{}
// 		contentNode.Type = currentNode.Type
// 		contentNode.Text = currentNode.Text
// 		if docId, ok := currentNode.Attributes["docId"].(float64); ok {
// 			contentNode.DocId = int64(docId)
// 		}
// 		if orderId, ok := currentNode.Attributes["orderId"].(float64); ok {
// 			contentNode.OrderId = int64(orderId)
// 		}
// 		if parentId, ok := currentNode.Attributes["parentId"].(float64); ok {
// 			contentNode.ParentId = int64(parentId)
// 		}
// 		if contentId, ok := currentNode.Attributes["contentId"].(float64); ok {
// 			contentNode.ContentId = int64(contentId)
// 		}
// 		contentNode.Marks = currentNode.Marks
// 		contentNode.Attributes = currentNode.Attributes
// 		node, ok := s.Value[contentNode.ContentId]
// 		if ok {
// 			modified := node.Validate(contentNode)
// 			fmt.Println("modified:", !modified)
// 		} else {
// 			fmt.Println("Added....")
// 		}
// 		children := currentNode.Content
// 		if children != nil {
// 			for i, child := range currentNode.Content {
// 				// update order of children
// 				child.Attributes["orderId"] = float64(i)
// 				child.Attributes["parentId"] = currentNode.Attributes["contentId"]
// 				queue.Enqueue(child)
// 			}
// 		}
// 	}
// }
