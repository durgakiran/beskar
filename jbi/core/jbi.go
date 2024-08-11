package core

import (
	"fmt"
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
		fmt.Println("No element exist in provided map")
		return Document{}
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
