package editor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

func CreateComment(spaceId uuid.UUID, pageId int64, userId uuid.UUID, request CreateCommentRequest) (Comment, error) {
	var comment Comment

	// Validate request
	if err := ValidateCreateCommentRequest(request, pageId, userId, spaceId); err != nil {
		return comment, err
	}

	// Determine doc_id
	var docId *int64
	if !request.IsDraft {
		// Get current published doc_id
		connPool := core.GetPool()
		ctx := context.Background()
		conn, err := connPool.Acquire(ctx)
		if err != nil {
			return comment, err
		}
		defer conn.Release()

		var publishedDocId int64
		err = conn.QueryRow(ctx, getCurrentPublishedDocIdQuery, pageId).Scan(&publishedDocId)
		if err == nil {
			docId = &publishedDocId
		}
		// If no published doc exists, docId remains nil (for draft comments)
	}

	// Validate inline comment if needed
	if request.CommentType == "inline" {
		if docId != nil {
			if err := ValidateInlineComment(false, *docId); err != nil {
				return comment, err
			}
		} else {
			// For draft inline comments, basic validation is done
			// Actual node type validation happens client-side
		}
	}

	// Create comment
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return comment, err
	}
	defer conn.Release()

	err = conn.QueryRow(ctx, createCommentQuery, pageId, docId, userId, request.CommentType, request.ParentCommentId, request.CommentText).Scan(
		&comment.Id, &comment.PageId, &comment.DocId, &comment.AuthorId, &comment.CommentType,
		&comment.ParentCommentId, &comment.CommentText, &comment.Resolved, &comment.ResolvedAt,
		&comment.ResolvedBy, &comment.CreatedAt, &comment.UpdatedAt, &comment.Edited, &comment.EditedAt,
	)
	if err != nil {
		logger().Error(fmt.Sprintf("Error creating comment: %v", err))
		return comment, err
	}

	return comment, nil
}

func GetComments(pageId int64, docId *int64, includeDraft bool, userId uuid.UUID) ([]Comment, error) {
	var comments []Comment

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return comments, err
	}
	defer conn.Release()

	var queryDocId interface{} = docId
	if docId == nil {
		queryDocId = nil
	}

	rows, err := conn.Query(ctx, getCommentsQuery, pageId, queryDocId)
	if err != nil {
		logger().Error(fmt.Sprintf("Error fetching comments: %v", err))
		return comments, err
	}
	defer rows.Close()

	for rows.Next() {
		var comment Comment
		err := rows.Scan(
			&comment.Id, &comment.PageId, &comment.DocId, &comment.AuthorId, &comment.CommentType,
			&comment.ParentCommentId, &comment.CommentText, &comment.Resolved, &comment.ResolvedAt,
			&comment.ResolvedBy, &comment.CreatedAt, &comment.UpdatedAt, &comment.Edited, &comment.EditedAt,
		)
		if err != nil {
			logger().Error(fmt.Sprintf("Error scanning comment: %v", err))
			continue
		}

		// Filter draft comments if includeDraft is false
		if !includeDraft && comment.DocId == nil {
			continue
		}

		comments = append(comments, comment)
	}

	return comments, nil
}

func GetCommentById(commentId uuid.UUID) (Comment, error) {
	var comment Comment

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return comment, err
	}
	defer conn.Release()

	err = conn.QueryRow(ctx, getCommentByIdQuery, commentId).Scan(
		&comment.Id, &comment.PageId, &comment.DocId, &comment.AuthorId, &comment.CommentType,
		&comment.ParentCommentId, &comment.CommentText, &comment.Resolved, &comment.ResolvedAt,
		&comment.ResolvedBy, &comment.CreatedAt, &comment.UpdatedAt, &comment.Edited, &comment.EditedAt,
	)
	if err != nil {
		return comment, err
	}

	return comment, nil
}

func UpdateComment(commentId uuid.UUID, userId uuid.UUID, newText string) error {
	// Verify comment exists and user is author
	comment, err := GetCommentById(commentId)
	if err != nil {
		return err
	}

	if comment.AuthorId != userId {
		return errors.New("only comment author can edit comment")
	}

	if newText == "" {
		return errors.New("comment text cannot be empty")
	}

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	_, err = conn.Exec(ctx, updateCommentQuery, newText, commentId)
	if err != nil {
		logger().Error(fmt.Sprintf("Error updating comment: %v", err))
		return err
	}

	return nil
}

func DeleteComment(commentId uuid.UUID, userId uuid.UUID, pageOwnerId uuid.UUID) error {
	// Verify comment exists and user is author or page owner
	comment, err := GetCommentById(commentId)
	if err != nil {
		return err
	}

	if comment.AuthorId != userId && pageOwnerId != userId {
		return errors.New("only comment author or page owner can delete comment")
	}

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	// Delete comment (CASCADE will handle replies)
	_, err = conn.Exec(ctx, deleteCommentQuery, commentId)
	if err != nil {
		logger().Error(fmt.Sprintf("Error deleting comment: %v", err))
		return err
	}

	return nil
}

func ResolveComment(commentId uuid.UUID, userId uuid.UUID, resolved bool) error {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	var resolvedBy interface{} = userId
	if !resolved {
		resolvedBy = nil
	}

	_, err = conn.Exec(ctx, resolveCommentQuery, resolved, commentId, resolvedBy)
	if err != nil {
		logger().Error(fmt.Sprintf("Error resolving comment: %v", err))
		return err
	}

	return nil
}

// RemoveCommentMarksFromDocument removes comment marks from document JSON
// This is called when a comment is deleted to clean up the document structure
func RemoveCommentMarksFromDocument(docJSON []byte, commentId uuid.UUID) ([]byte, error) {
	// Parse JSON
	var doc map[string]interface{}
	if err := json.Unmarshal(docJSON, &doc); err != nil {
		return nil, err
	}

	// Recursive function to remove comment marks
	var removeMarks func(node interface{}) bool
	removeMarks = func(node interface{}) bool {
		nodeMap, ok := node.(map[string]interface{})
		if !ok {
			return false
		}

		modified := false

		// Check and modify marks
		if marks, ok := nodeMap["marks"].([]interface{}); ok {
			var newMarks []interface{}
			for _, mark := range marks {
				markMap, ok := mark.(map[string]interface{})
				if !ok {
					newMarks = append(newMarks, mark)
					continue
				}
				if markType, ok := markMap["type"].(string); ok && markType == "comment" {
					if attrs, ok := markMap["attrs"].(map[string]interface{}); ok {
						if commentIdStr, ok := attrs["commentId"].(string); ok {
							if markCommentId, err := uuid.Parse(commentIdStr); err == nil {
								if markCommentId == commentId {
									// Skip this mark (remove it)
									modified = true
									continue
								}
							}
						}
					}
				}
				newMarks = append(newMarks, mark)
			}
			if modified {
				nodeMap["marks"] = newMarks
			}
		}

		// Recursively process content
		if content, ok := nodeMap["content"].([]interface{}); ok {
			for _, child := range content {
				if removeMarks(child) {
					modified = true
				}
			}
		}

		return modified
	}

	// Process document
	if content, ok := doc["content"].([]interface{}); ok {
		for _, child := range content {
			removeMarks(child)
		}
	}

	// Convert back to JSON
	result, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}

	return result, nil
}
