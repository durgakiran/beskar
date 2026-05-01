package assetref

import "time"

const (
	AssetTypeAttachment = "attachment"
	AssetTypeImage      = "image"
)

const (
	SourceKindDraftDoc     = "draft_doc"
	SourceKindPublishedDoc = "published_doc"
	SourceKindCommentReply = "comment_reply"
)

const (
	DraftStatusUnknown            = "unknown"
	DraftStatusIndexed            = "indexed"
	DraftStatusBlockedBinaryDraft = "blocked_binary_draft"
)

// PayloadReferences is the request payload contract accepted from editor/comment write paths.
// Attachments contain attachment UUIDs; Images contain image public_names.
type PayloadReferences struct {
	Attachments []string `json:"attachments"`
	Images      []string `json:"images"`
}

// InputReference is the normalized application payload used to replace references for a source snapshot.
type InputReference struct {
	AssetType string `json:"assetType"`
	AssetID   string `json:"assetId"`
}

// ReferenceRow represents a retained asset reference row in core.asset_reference.
type ReferenceRow struct {
	ID         string    `db:"id"`
	AssetType  string    `db:"asset_type"`
	AssetID    string    `db:"asset_id"`
	PageID     int64     `db:"page_id"`
	DocID      *int64    `db:"doc_id"`
	SourceKind string    `db:"source_kind"`
	SourceID   string    `db:"source_id"`
	LastSeenAt time.Time `db:"last_seen_at"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

// CoverageRow represents per-page reference coverage state used to gate cleanup.
type CoverageRow struct {
	PageID                int64      `db:"page_id"`
	PublishedBackfilledAt *time.Time `db:"published_backfilled_at"`
	CommentBackfilledAt   *time.Time `db:"comment_backfilled_at"`
	DraftStatus           string     `db:"draft_status"`
	DraftCheckedAt        *time.Time `db:"draft_checked_at"`
	CleanupEligible       bool       `db:"cleanup_eligible"`
	UpdatedAt             time.Time  `db:"updated_at"`
}
