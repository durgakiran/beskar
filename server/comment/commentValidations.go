package comment

type CreateThreadReq struct {
	CommentID  string `json:"commentId" validate:"required,uuid"`
	QuotedText string `json:"quotedText" validate:"required"`
	Body       string `json:"body" validate:"required"`
}

type CreateReplyReq struct {
	Body string `json:"body" validate:"required"`
}

type EditReplyReq struct {
	Body string `json:"body" validate:"required"`
}
