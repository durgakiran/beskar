package editor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

func ValidateCommentPermission(userId uuid.UUID, spaceId uuid.UUID) error {
	// Check if user has commentor permission or higher (view permission includes commentor)
	hasPermission := core.ValidateUserSpacePermissions(spaceId, userId, "view")
	if !hasPermission {
		return errors.New("user does not have permission to comment")
	}
	return nil
}

func ValidateCreateCommentRequest(request CreateCommentRequest, pageId int64, userId uuid.UUID, spaceId uuid.UUID) error {
	// Validate permission
	if err := ValidateCommentPermission(userId, spaceId); err != nil {
		return err
	}

	// Validate comment type
	if request.CommentType != "inline" && request.CommentType != "page_end" {
		return errors.New("invalid comment type, must be 'inline' or 'page_end'")
	}

	// Validate comment text is not empty
	if request.CommentText == "" {
		return errors.New("comment text cannot be empty")
	}

	// For replies, validate parent comment exists and belongs to same page
	if request.ParentCommentId != nil {
		parentComment, err := GetCommentById(*request.ParentCommentId)
		if err != nil {
			return fmt.Errorf("parent comment not found: %v", err)
		}
		if parentComment.PageId != pageId {
			return errors.New("parent comment does not belong to this page")
		}
	}

	return nil
}

// ValidateInlineComment checks if the comment can be placed on the selected text
// Note: Since we're using marks in the document, the actual validation happens
// client-side when the mark is created. This function is kept for future server-side
// validation if needed (e.g., to verify node type is not codeBlock).
func ValidateInlineComment(isDraft bool, docId int64) error {
	// For mark-based approach, validation is primarily client-side
	// Server-side validation can check if document exists and user has permission
	// The actual node type validation happens in the editor when creating the mark

	if !isDraft {
		// For published content, verify doc_id exists
		connPool := core.GetPool()
		ctx := context.Background()
		conn, err := connPool.Acquire(ctx)
		if err != nil {
			return err
		}
		defer conn.Release()

		var exists bool
		err = conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM core.page_doc_map WHERE doc_id = $1 AND draft = 0)", docId).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return errors.New("document not found")
		}
	}

	return nil
}

// Helper function to check if a node type allows comments
func IsCommentableNodeType(nodeType string) bool {
	excludedTypes := []string{
		"codeBlock",
		"codeBlockLowlight",
		"imageBlock",
		"mathBlock",
		"table",
		"horizontalRule",
	}

	for _, excluded := range excludedTypes {
		if nodeType == excluded {
			return false
		}
	}
	return true
}

// ExtractCommentMarksFromJSON extracts all comment marks from document JSON
// This is used to track which comments are in the document
func ExtractCommentMarksFromJSON(docJSON []byte) ([]uuid.UUID, error) {
	var doc map[string]interface{}
	if err := json.Unmarshal(docJSON, &doc); err != nil {
		return nil, err
	}

	var commentIds []uuid.UUID

	var traverse func(node interface{})
	traverse = func(node interface{}) {
		nodeMap, ok := node.(map[string]interface{})
		if !ok {
			return
		}

		// Check if this node has marks
		if marks, ok := nodeMap["marks"].([]interface{}); ok {
			for _, mark := range marks {
				markMap, ok := mark.(map[string]interface{})
				if !ok {
					continue
				}
				if markType, ok := markMap["type"].(string); ok && markType == "comment" {
					if attrs, ok := markMap["attrs"].(map[string]interface{}); ok {
						if commentIdStr, ok := attrs["commentId"].(string); ok {
							if commentId, err := uuid.Parse(commentIdStr); err == nil {
								commentIds = append(commentIds, commentId)
							}
						}
					}
				}
			}
		}

		// Recursively check content
		if content, ok := nodeMap["content"].([]interface{}); ok {
			for _, child := range content {
				traverse(child)
			}
		}
	}

	if content, ok := doc["content"].([]interface{}); ok {
		for _, child := range content {
			traverse(child)
		}
	}

	return commentIds, nil
}
