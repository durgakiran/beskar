package comment

type CreateThreadReq struct {
	CommentID        string        `json:"commentId" validate:"required,uuid"`
	Anchor           CommentAnchor `json:"anchor"`
	PublishedVisible *bool         `json:"publishedVisible,omitempty"`
	Body             string        `json:"body" validate:"required"`
	AttachmentIDs    []string      `json:"attachmentIds,omitempty"`
}

type CreateReplyReq struct {
	Body          string   `json:"body" validate:"required"`
	AttachmentIDs []string `json:"attachmentIds,omitempty"`
}

type EditReplyReq struct {
	Body          string   `json:"body" validate:"required"`
	AttachmentIDs []string `json:"attachmentIds,omitempty"`
}
