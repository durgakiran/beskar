package services

// Orphan cleanup (future): periodically find rows in core.attachment where the attachment id
// no longer appears in any document JSON (core.content_draft.data, etc.), set deleted_at, and
// remove the file from disk. Do not delete immediately on chip removal — see attachmentService.go.
