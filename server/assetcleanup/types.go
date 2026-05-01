package assetcleanup

import (
	"time"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/editor"
	"github.com/google/uuid"
)

type PublishedDocVersion struct {
	DocID   int64
	PageID  int64
	SpaceID uuid.UUID
	Nodes   editor.NodeData
}

type PublishedBackfillResult struct {
	Scanned int
	Updated int
	Failed  int
}

type CommentBackfillResult struct {
	Replies int
	Updated int
	Failed  int
}

type DraftCoverageResult struct {
	BlockedDraftPages int
	EligiblePages     int
}

type MarkRunResult struct {
	PagesScanned      int
	AssetsMarked      int
	AssetsDeleted     int
	AssetsReactivated int
	BytesRemoved      int64
	ReachedRunCap     bool
	CompletedAt       time.Time
}

type PurgeRunResult struct {
	AssetsPurged  int
	BytesPurged   int64
	ReachedRunCap bool
	CompletedAt   time.Time
}

type RestoreResult struct {
	AssetType     string    `json:"assetType"`
	AssetID       string    `json:"assetId"`
	PageID        int64     `json:"pageId"`
	SpaceID       uuid.UUID `json:"spaceId"`
	BytesRestored int64     `json:"bytesRestored"`
	WasRestored   bool      `json:"wasRestored"`
}

type runtimeStats struct {
	LastMarkRun  *MarkRunResult
	LastPurgeRun *PurgeRunResult
}

type assetRow struct {
	AssetType  string
	AssetID    string
	PageID     int64
	SpaceID    uuid.UUID
	SizeBytes  int64
	StorageKey string
	OrphanedAt *time.Time
	DeletedAt  *time.Time
	PurgedAt   *time.Time
}

type liveReference struct {
	AssetType string
	AssetID   string
}

type commentReplyAttachmentRow struct {
	ReplyID       string
	PageID        int64
	AttachmentIDs []string
}

type pageCoverageState struct {
	PageID                int64
	PublishedBackfilledAt *time.Time
	CommentBackfilledAt   *time.Time
	DraftStatus           string
	CleanupEligible       bool
}

type docReindexResult struct {
	DocID  int64
	PageID int64
	Refs   []assetref.InputReference
}
