package comment

import "time"

type CommentThread struct {
	ID         string         `json:"id"`
	DocumentID string         `json:"documentId"`
	CommentID  string         `json:"commentId"`
	QuotedText string         `json:"quotedText"`
	CreatedBy  *AuthorInfo    `json:"createdBy"` // nil for deleted user
	ResolvedBy *AuthorInfo    `json:"resolvedBy,omitempty"`
	ResolvedAt *time.Time     `json:"resolvedAt,omitempty"`
	CreatedAt  time.Time      `json:"createdAt"`
	Replies    []CommentReply `json:"replies"`
}

type CommentReply struct {
	ID        string      `json:"id"`
	ThreadID  string      `json:"threadId"`
	Author    *AuthorInfo `json:"author"` // nil for deleted user
	Body      string      `json:"body"`
	EditedAt  *time.Time  `json:"editedAt,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
}

type AuthorInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
