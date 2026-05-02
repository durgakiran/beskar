package docversioncleanup

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrPublishedDocCoveragePreflightFailed = errors.New("published document asset reference coverage preflight failed")

type PublishedDocCoveragePreflight struct {
	CheckedPageCount int64 `json:"checkedPageCount"`
	MissingPageCount int64 `json:"missingPageCount"`
	Passed           bool  `json:"passed"`
}

type CandidateVersion struct {
	DocID           int64
	PageID          int64
	SpaceID         uuid.UUID
	AccountID       uuid.UUID
	PlanID          *string
	PlanCode        *string
	Version         time.Time
	RetentionDays   int
	RetentionCutoff time.Time
}

type DryRunImpact struct {
	FallbackRetentionDays       int        `json:"fallbackRetentionDays"`
	AffectedPlanCodes           []string   `json:"affectedPlanCodes"`
	CandidateVersionCount       int64      `json:"candidateVersionCount"`
	AffectedPageCount           int64      `json:"affectedPageCount"`
	AffectedAccountCount        int64      `json:"affectedAccountCount"`
	OldestCandidateVersion      *time.Time `json:"oldestCandidateVersion,omitempty"`
	NewestCandidateVersion      *time.Time `json:"newestCandidateVersion,omitempty"`
	EstimatedContentRows        int64      `json:"estimatedContentRows"`
	EstimatedTextNodeRows       int64      `json:"estimatedTextNodeRows"`
	EstimatedAssetReferenceRows int64      `json:"estimatedAssetReferenceRows"`
}

type PruneBatchResult struct {
	JobRunID                  uuid.UUID `json:"jobRunId"`
	PageID                    int64     `json:"pageId,omitempty"`
	PrunedVersionCount        int       `json:"prunedVersionCount"`
	SkippedAfterRelock        int       `json:"skippedAfterRelock"`
	ContentRowsDeleted        int64     `json:"contentRowsDeleted"`
	TextNodeRowsDeleted       int64     `json:"textNodeRowsDeleted"`
	AssetReferenceRowsDeleted int64     `json:"assetReferenceRowsDeleted"`
}

type DryRunResult struct {
	Preflight   PublishedDocCoveragePreflight `json:"preflight"`
	Impact      DryRunImpact                  `json:"impact"`
	CompletedAt time.Time                     `json:"completedAt"`
}

type CleanupRunResult struct {
	JobRunID                  uuid.UUID                     `json:"jobRunId"`
	DryRun                    bool                          `json:"dryRun"`
	Preflight                 PublishedDocCoveragePreflight `json:"preflight"`
	DryRunImpact              *DryRunImpact                 `json:"dryRunImpact,omitempty"`
	Batches                   []PruneBatchResult            `json:"batches,omitempty"`
	PrunedVersionCount        int                           `json:"prunedVersionCount"`
	SkippedAfterRelock        int                           `json:"skippedAfterRelock"`
	ContentRowsDeleted        int64                         `json:"contentRowsDeleted"`
	TextNodeRowsDeleted       int64                         `json:"textNodeRowsDeleted"`
	AssetReferenceRowsDeleted int64                         `json:"assetReferenceRowsDeleted"`
	ReachedRunCap             bool                          `json:"reachedRunCap"`
	CompletedAt               time.Time                     `json:"completedAt"`
}

type runtimeStats struct {
	LastDryRun  *DryRunResult
	LastCleanup *CleanupRunResult
}

type lockedPruneCandidate struct {
	DocID               int64
	PageID              int64
	SpaceID             uuid.UUID
	AccountID           uuid.UUID
	PlanID              *string
	PlanCode            *string
	Version             time.Time
	RetentionDays       int
	RetentionCutoff     time.Time
	ContentNodeCount    int64
	TextNodeCount       int64
	AssetReferenceCount int64
}
