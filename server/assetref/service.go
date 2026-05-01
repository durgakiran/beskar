package assetref

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type queryer interface {
	Exec(context.Context, string, ...any) (pgconnCommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// pgx.Tx and pgxpool.Pool both return pgconn.CommandTag, but we keep the interface local.
type pgconnCommandTag interface {
	RowsAffected() int64
	String() string
}

func normalizeSourceID(value string) string {
	return strings.TrimSpace(value)
}

func normalizeAssetID(value string) string {
	return strings.TrimSpace(value)
}

func validateAssetType(assetType string) error {
	switch assetType {
	case AssetTypeAttachment, AssetTypeImage:
		return nil
	default:
		return fmt.Errorf("unsupported asset type: %s", assetType)
	}
}

func validateSourceKind(sourceKind string) error {
	switch sourceKind {
	case SourceKindDraftDoc, SourceKindPublishedDoc, SourceKindCommentReply:
		return nil
	default:
		return fmt.Errorf("unsupported source kind: %s", sourceKind)
	}
}

func validateDraftStatus(status string) error {
	switch status {
	case DraftStatusUnknown, DraftStatusIndexed, DraftStatusBlockedBinaryDraft:
		return nil
	default:
		return fmt.Errorf("unsupported draft status: %s", status)
	}
}

func dedupeReferences(refs []InputReference) ([]InputReference, error) {
	seen := make(map[string]struct{}, len(refs))
	out := make([]InputReference, 0, len(refs))

	for _, ref := range refs {
		ref.AssetType = strings.TrimSpace(ref.AssetType)
		ref.AssetID = normalizeAssetID(ref.AssetID)
		if err := validateAssetType(ref.AssetType); err != nil {
			return nil, err
		}
		if ref.AssetID == "" {
			return nil, errors.New("asset id is required")
		}

		key := ref.AssetType + "\x00" + ref.AssetID
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, ref)
	}

	return out, nil
}

func replaceSourceReferences(ctx context.Context, tx pgx.Tx, pageID int64, docID *int64, sourceKind string, sourceID string, refs []InputReference) error {
	if tx == nil {
		return errors.New("transaction is required")
	}
	if pageID < 1 {
		return errors.New("page id is required")
	}
	sourceID = normalizeSourceID(sourceID)
	if sourceID == "" {
		return errors.New("source id is required")
	}
	if err := validateSourceKind(sourceKind); err != nil {
		return err
	}
	if docID != nil && *docID < 1 {
		return errors.New("doc id must be positive")
	}

	deduped, err := dedupeReferences(refs)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, deleteSourceReferencesQuery, sourceKind, sourceID); err != nil {
		return err
	}

	if len(deduped) == 0 {
		return nil
	}

	now := time.Now().UTC()
	for _, ref := range deduped {
		if _, err := tx.Exec(ctx, insertReferenceQuery,
			ref.AssetType,
			ref.AssetID,
			pageID,
			docID,
			sourceKind,
			sourceID,
			now,
		); err != nil {
			return err
		}
	}

	return nil
}

func DeleteSourceReferences(ctx context.Context, tx pgx.Tx, sourceKind string, sourceID string) error {
	if tx == nil {
		return errors.New("transaction is required")
	}
	sourceID = normalizeSourceID(sourceID)
	if sourceID == "" {
		return errors.New("source id is required")
	}
	if err := validateSourceKind(sourceKind); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, deleteSourceReferencesQuery, sourceKind, sourceID)
	return err
}

func ReplaceDraftDocReferences(ctx context.Context, tx pgx.Tx, pageID int64, docID int64, refs []InputReference) error {
	return replaceSourceReferences(ctx, tx, pageID, &docID, SourceKindDraftDoc, fmt.Sprintf("%d", docID), refs)
}

func ReplacePublishedDocReferences(ctx context.Context, tx pgx.Tx, pageID int64, docID int64, refs []InputReference) error {
	return replaceSourceReferences(ctx, tx, pageID, &docID, SourceKindPublishedDoc, fmt.Sprintf("%d", docID), refs)
}

func ReplaceCommentReplyReferences(ctx context.Context, tx pgx.Tx, pageID int64, replyID string, refs []InputReference) error {
	return replaceSourceReferences(ctx, tx, pageID, nil, SourceKindCommentReply, replyID, refs)
}

func DeleteCommentReplyReferences(ctx context.Context, tx pgx.Tx, replyID string) error {
	return DeleteSourceReferences(ctx, tx, SourceKindCommentReply, replyID)
}

func NormalizePayloadReferences(ctx context.Context, tx pgx.Tx, pageID int64, payload *PayloadReferences) ([]InputReference, error) {
	if tx == nil {
		return nil, errors.New("transaction is required")
	}
	if pageID < 1 {
		return nil, errors.New("page id is required")
	}
	if payload == nil {
		return nil, nil
	}

	refs := make([]InputReference, 0, len(payload.Attachments)+len(payload.Images))

	seenAttachments := make(map[string]struct{}, len(payload.Attachments))
	for _, rawID := range payload.Attachments {
		attachmentID := strings.TrimSpace(rawID)
		if attachmentID == "" {
			continue
		}
		if _, ok := seenAttachments[attachmentID]; ok {
			continue
		}
		if _, err := uuid.Parse(attachmentID); err != nil {
			return nil, fmt.Errorf("invalid attachment id %q", rawID)
		}

		var canonicalID string
		err := tx.QueryRow(ctx, resolveAttachmentReferenceQuery, attachmentID, pageID).Scan(&canonicalID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("attachment %s is not active on page %d", attachmentID, pageID)
		}
		if err != nil {
			return nil, err
		}

		seenAttachments[attachmentID] = struct{}{}
		refs = append(refs, InputReference{
			AssetType: AssetTypeAttachment,
			AssetID:   canonicalID,
		})
	}

	seenImages := make(map[string]struct{}, len(payload.Images))
	for _, rawName := range payload.Images {
		publicName := strings.TrimSpace(rawName)
		if publicName == "" {
			continue
		}
		if _, ok := seenImages[publicName]; ok {
			continue
		}

		var canonicalID string
		err := tx.QueryRow(ctx, resolveImageReferenceQuery, publicName, pageID).Scan(&canonicalID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("image %s is not active on page %d", publicName, pageID)
		}
		if err != nil {
			return nil, err
		}

		seenImages[publicName] = struct{}{}
		refs = append(refs, InputReference{
			AssetType: AssetTypeImage,
			AssetID:   canonicalID,
		})
	}

	return refs, nil
}

func ListPageAssetReferences(ctx context.Context, pageID int64) ([]ReferenceRow, error) {
	if pageID < 1 {
		return nil, errors.New("page id is required")
	}
	rows, err := core.GetPool().Query(ctx, listPageReferencesQuery, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	refs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReferenceRow, error) {
		var ref ReferenceRow
		err := row.Scan(
			&ref.ID,
			&ref.AssetType,
			&ref.AssetID,
			&ref.PageID,
			&ref.DocID,
			&ref.SourceKind,
			&ref.SourceID,
			&ref.LastSeenAt,
			&ref.CreatedAt,
			&ref.UpdatedAt,
		)
		return ref, err
	})
	if err != nil {
		return nil, err
	}

	return refs, nil
}

func ListAssetReferences(ctx context.Context, assetType, assetID string) ([]ReferenceRow, error) {
	assetType = strings.TrimSpace(assetType)
	assetID = normalizeAssetID(assetID)
	if err := validateAssetType(assetType); err != nil {
		return nil, err
	}
	if assetID == "" {
		return nil, errors.New("asset id is required")
	}

	rows, err := core.GetPool().Query(ctx, listAssetReferencesQuery, assetType, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	refs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReferenceRow, error) {
		var ref ReferenceRow
		err := row.Scan(
			&ref.ID,
			&ref.AssetType,
			&ref.AssetID,
			&ref.PageID,
			&ref.DocID,
			&ref.SourceKind,
			&ref.SourceID,
			&ref.LastSeenAt,
			&ref.CreatedAt,
			&ref.UpdatedAt,
		)
		return ref, err
	})
	if err != nil {
		return nil, err
	}

	return refs, nil
}

func GetCoverage(ctx context.Context, pageID int64) (*CoverageRow, error) {
	if pageID < 1 {
		return nil, errors.New("page id is required")
	}
	var row CoverageRow
	err := core.GetPool().QueryRow(ctx, getCoverageQuery, pageID).Scan(
		&row.PageID,
		&row.PublishedBackfilledAt,
		&row.CommentBackfilledAt,
		&row.DraftStatus,
		&row.DraftCheckedAt,
		&row.CleanupEligible,
		&row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func EnsureCoverageRow(ctx context.Context, tx pgx.Tx, pageID int64) error {
	if tx == nil {
		return errors.New("transaction is required")
	}
	if pageID < 1 {
		return errors.New("page id is required")
	}
	_, err := tx.Exec(ctx, ensureCoverageRowQuery, pageID, DraftStatusUnknown)
	return err
}

func MarkPublishedBackfilled(ctx context.Context, tx pgx.Tx, pageID int64, at time.Time) error {
	if err := EnsureCoverageRow(ctx, tx, pageID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, updateCoveragePublishedBackfilledQuery, pageID, at.UTC())
	return err
}

func MarkCommentBackfilled(ctx context.Context, tx pgx.Tx, pageID int64, at time.Time) error {
	if err := EnsureCoverageRow(ctx, tx, pageID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, updateCoverageCommentBackfilledQuery, pageID, at.UTC())
	return err
}

func SetDraftStatus(ctx context.Context, tx pgx.Tx, pageID int64, status string, checkedAt time.Time) error {
	if err := validateDraftStatus(status); err != nil {
		return err
	}
	if err := EnsureCoverageRow(ctx, tx, pageID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, updateCoverageDraftStatusQuery, pageID, status, checkedAt.UTC())
	return err
}

func SetCleanupEligible(ctx context.Context, tx pgx.Tx, pageID int64, eligible bool) error {
	if err := EnsureCoverageRow(ctx, tx, pageID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, updateCoverageCleanupEligibleQuery, pageID, eligible)
	return err
}

func HasActiveDraft(ctx context.Context, tx pgx.Tx, pageID int64) (bool, error) {
	if tx == nil {
		return false, errors.New("transaction is required")
	}
	if pageID < 1 {
		return false, errors.New("page id is required")
	}
	var hasDraft bool
	if err := tx.QueryRow(ctx, hasActiveDraftQuery, pageID).Scan(&hasDraft); err != nil {
		return false, err
	}
	return hasDraft, nil
}

func RecomputeCleanupEligibility(ctx context.Context, tx pgx.Tx, pageID int64) (bool, error) {
	if tx == nil {
		return false, errors.New("transaction is required")
	}
	if err := EnsureCoverageRow(ctx, tx, pageID); err != nil {
		return false, err
	}

	var coverage CoverageRow
	err := tx.QueryRow(ctx, getCoverageQuery, pageID).Scan(
		&coverage.PageID,
		&coverage.PublishedBackfilledAt,
		&coverage.CommentBackfilledAt,
		&coverage.DraftStatus,
		&coverage.DraftCheckedAt,
		&coverage.CleanupEligible,
		&coverage.UpdatedAt,
	)
	if err != nil {
		return false, err
	}

	hasDraft, err := HasActiveDraft(ctx, tx, pageID)
	if err != nil {
		return false, err
	}

	eligible := coverage.PublishedBackfilledAt != nil &&
		coverage.CommentBackfilledAt != nil &&
		(coverage.DraftStatus == DraftStatusIndexed || !hasDraft)

	if _, err := tx.Exec(ctx, updateCoverageCleanupEligibleQuery, pageID, eligible); err != nil {
		return false, err
	}
	return eligible, nil
}
