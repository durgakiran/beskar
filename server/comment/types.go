package comment

import "time"

type CommentAnchor struct {
	QuotedText  string `json:"quotedText"`
	PrefixText  string `json:"prefixText"`
	SuffixText  string `json:"suffixText"`
	BlockID     string `json:"blockId"`
	Start       int    `json:"start"`
	End         int    `json:"end"`
	VersionHint string `json:"versionHint"`
}

type CommentThread struct {
	ID               string         `json:"id"`
	DocumentID       string         `json:"documentId"`
	CommentID        string         `json:"commentId"`
	Anchor           CommentAnchor  `json:"anchor"`
	PublishedVisible bool           `json:"publishedVisible"`
	Orphaned         bool           `json:"orphaned"`
	CreatedBy        *AuthorInfo    `json:"createdBy"` // nil for deleted user
	ResolvedBy       *AuthorInfo    `json:"resolvedBy,omitempty"`
	ResolvedAt       *time.Time     `json:"resolvedAt,omitempty"`
	CreatedAt        time.Time      `json:"createdAt"`
	Replies          []CommentReply `json:"replies"`
}

type CommentReply struct {
	ID          string              `json:"id"`
	ThreadID    string              `json:"threadId"`
	Author      *AuthorInfo         `json:"author"` // nil for deleted user
	Body        string              `json:"body"`
	EditedAt    *time.Time          `json:"editedAt,omitempty"`
	CreatedAt   time.Time           `json:"createdAt"`
	Attachments []CommentAttachment `json:"attachments"`
}

type AuthorInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type CommentAttachment struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	FileName string `json:"fileName"`
	MimeType string `json:"mimeType"`
	FileSize int64  `json:"fileSize"`
}
