package docversioncleanup

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const cleanupReasonRetentionExpired = "retention_expired"

func CheckPublishedDocCoveragePreflight(ctx context.Context) (PublishedDocCoveragePreflight, error) {
	result := PublishedDocCoveragePreflight{}
	err := core.GetPool().QueryRow(ctx, publishedDocCoveragePreflightQuery).Scan(
		&result.CheckedPageCount,
		&result.MissingPageCount,
	)
	if err != nil {
		return result, err
	}
	result.Passed = result.MissingPageCount == 0
	return result, nil
}

func ListCandidateVersions(ctx context.Context, defaultRetentionDays int, limit int) ([]CandidateVersion, error) {
	if defaultRetentionDays <= 0 {
		defaultRetentionDays = 7
	}
	if limit <= 0 {
		limit = 500
	}

	rows, err := core.GetPool().Query(ctx, listCandidateVersionsQuery, defaultRetentionDays, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (CandidateVersion, error) {
		var candidate CandidateVersion
		var planID string
		var planCode string
		err := row.Scan(
			&candidate.DocID,
			&candidate.PageID,
			&candidate.SpaceID,
			&candidate.AccountID,
			&planID,
			&planCode,
			&candidate.Version,
			&candidate.RetentionDays,
			&candidate.RetentionCutoff,
		)
		if err != nil {
			return candidate, err
		}
		candidate.PlanID = stringPtrIfNotEmpty(planID)
		candidate.PlanCode = stringPtrIfNotEmpty(planCode)
		return candidate, nil
	})
}

func EstimateDryRunImpact(ctx context.Context, defaultRetentionDays int, limit int) (DryRunImpact, error) {
	if defaultRetentionDays <= 0 {
		defaultRetentionDays = 7
	}
	if limit <= 0 {
		limit = 500
	}

	result := DryRunImpact{}
	var affectedPlanCodes string
	var oldest pgtype.Timestamptz
	var newest pgtype.Timestamptz
	err := core.GetPool().QueryRow(ctx, dryRunImpactQuery, defaultRetentionDays, limit).Scan(
		&result.FallbackRetentionDays,
		&affectedPlanCodes,
		&result.CandidateVersionCount,
		&result.AffectedPageCount,
		&result.AffectedAccountCount,
		&oldest,
		&newest,
		&result.EstimatedContentRows,
		&result.EstimatedTextNodeRows,
		&result.EstimatedAssetReferenceRows,
	)
	if err != nil {
		return result, err
	}
	result.AffectedPlanCodes = splitPlanCodes(affectedPlanCodes)
	result.OldestCandidateVersion = timePtrIfValid(oldest)
	result.NewestCandidateVersion = timePtrIfValid(newest)
	return result, nil
}

func PruneNextPageBatch(ctx context.Context, defaultRetentionDays int, batchSize int, jobRunID uuid.UUID) (PruneBatchResult, error) {
	if defaultRetentionDays <= 0 {
		defaultRetentionDays = 7
	}
	if batchSize <= 0 {
		batchSize = 500
	}
	if jobRunID == uuid.Nil {
		jobRunID = uuid.New()
	}

	result := PruneBatchResult{JobRunID: jobRunID}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	candidates, err := loadLockedPruneCandidates(ctx, tx, defaultRetentionDays, batchSize)
	if err != nil {
		return result, err
	}
	if len(candidates) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		return result, nil
	}

	result.PageID = candidates[0].PageID
	for _, candidate := range candidates {
		stillPrunable, err := isDocStillPrunable(ctx, tx, candidate.DocID, defaultRetentionDays)
		if err != nil {
			return result, err
		}
		if !stillPrunable {
			result.SkippedAfterRelock++
			continue
		}

		if err := insertCleanupLog(ctx, tx, candidate, jobRunID); err != nil {
			return result, err
		}

		tag, err := tx.Exec(ctx, deletePublishedDocAssetReferencesQuery, strconv.FormatInt(candidate.DocID, 10))
		if err != nil {
			return result, err
		}
		result.AssetReferenceRowsDeleted += tag.RowsAffected()

		tag, err = tx.Exec(ctx, deletePageDocMapQuery, candidate.DocID)
		if err != nil {
			return result, err
		}
		if tag.RowsAffected() == 0 {
			return result, fmt.Errorf("document version cleanup: locked doc_id %d was not deleted", candidate.DocID)
		}

		result.PrunedVersionCount++
		result.ContentRowsDeleted += candidate.ContentNodeCount
		result.TextNodeRowsDeleted += candidate.TextNodeCount
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func timePtrIfValid(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func splitPlanCodes(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	return strings.Split(value, ",")
}

func loadLockedPruneCandidates(ctx context.Context, tx pgx.Tx, defaultRetentionDays int, batchSize int) ([]lockedPruneCandidate, error) {
	rows, err := tx.Query(ctx, lockNextPagePruneCandidatesQuery, defaultRetentionDays, batchSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (lockedPruneCandidate, error) {
		var candidate lockedPruneCandidate
		var planID string
		var planCode string
		err := row.Scan(
			&candidate.DocID,
			&candidate.PageID,
			&candidate.SpaceID,
			&candidate.AccountID,
			&planID,
			&planCode,
			&candidate.Version,
			&candidate.RetentionDays,
			&candidate.RetentionCutoff,
			&candidate.ContentNodeCount,
			&candidate.TextNodeCount,
			&candidate.AssetReferenceCount,
		)
		if err != nil {
			return candidate, err
		}
		candidate.PlanID = stringPtrIfNotEmpty(planID)
		candidate.PlanCode = stringPtrIfNotEmpty(planCode)
		return candidate, nil
	})
}

func insertCleanupLog(ctx context.Context, tx pgx.Tx, candidate lockedPruneCandidate, jobRunID uuid.UUID) error {
	_, err := tx.Exec(
		ctx,
		insertCleanupLogQuery,
		candidate.DocID,
		candidate.PageID,
		candidate.SpaceID,
		candidate.AccountID,
		nullableString(candidate.PlanID),
		nullableString(candidate.PlanCode),
		candidate.Version,
		cleanupReasonRetentionExpired,
		candidate.RetentionDays,
		candidate.RetentionCutoff,
		candidate.ContentNodeCount,
		candidate.TextNodeCount,
		candidate.AssetReferenceCount,
		jobRunID,
	)
	return err
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func isDocStillPrunable(ctx context.Context, tx pgx.Tx, docID int64, defaultRetentionDays int) (bool, error) {
	var stillPrunable bool
	err := tx.QueryRow(ctx, isDocStillPrunableQuery, docID, defaultRetentionDays).Scan(&stillPrunable)
	return stillPrunable, err
}
