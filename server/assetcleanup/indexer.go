package assetcleanup

import (
	"context"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/editor"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

func listActiveDocumentPages(ctx context.Context) ([]int64, error) {
	rows, err := core.GetPool().Query(ctx, listActiveDocumentPagesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (int64, error) {
		var pageID int64
		err := row.Scan(&pageID)
		return pageID, err
	})
}

func listPublishedDocVersions(ctx context.Context, pageID *int64) ([]PublishedDocVersion, error) {
	query := listPublishedDocVersionsQuery
	args := []any{}
	if pageID != nil {
		query = listPublishedDocVersionsByPageQuery
		args = append(args, *pageID)
	}

	rows, err := core.GetPool().Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PublishedDocVersion, error) {
		var version PublishedDocVersion
		err := row.Scan(&version.DocID, &version.PageID, &version.SpaceID)
		return version, err
	})
}

func loadPublishedDocVersion(ctx context.Context, tx pgx.Tx, docID int64) (PublishedDocVersion, error) {
	var version PublishedDocVersion
	if err := tx.QueryRow(ctx, getPublishedDocVersionMetaQuery, docID).Scan(&version.DocID, &version.PageID, &version.SpaceID); err != nil {
		return PublishedDocVersion{}, err
	}

	contentRows, err := tx.Query(ctx, getPublishedDocNodesByDocIDQuery, docID)
	if err != nil {
		return PublishedDocVersion{}, err
	}
	content, err := pgx.CollectRows(contentRows, pgx.RowToStructByNameLax[editor.ContentNode])
	if err != nil {
		return PublishedDocVersion{}, err
	}

	textRows, err := tx.Query(ctx, getPublishedTextNodesByDocIDQuery, docID)
	if err != nil {
		return PublishedDocVersion{}, err
	}
	text, err := pgx.CollectRows(textRows, pgx.RowToStructByNameLax[editor.TextNode])
	if err != nil {
		return PublishedDocVersion{}, err
	}

	version.Nodes = editor.NodeData{
		Content: content,
		Text:    text,
	}
	return version, nil
}

func reindexPublishedDocTx(ctx context.Context, tx pgx.Tx, docID int64) error {
	version, err := loadPublishedDocVersion(ctx, tx, docID)
	if err != nil {
		return err
	}
	payload := ExtractPayloadReferencesFromNodeData(version.Nodes)
	refs, err := assetref.NormalizePayloadReferences(ctx, tx, version.PageID, payload)
	if err != nil {
		return err
	}
	return assetref.ReplacePublishedDocReferences(ctx, tx, version.PageID, version.DocID, refs)
}

func ReindexPublishedDoc(ctx context.Context, docID int64) error {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := reindexPublishedDocTx(ctx, tx, docID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ReindexPublishedPage(ctx context.Context, pageID int64) (int, error) {
	versions, err := listPublishedDocVersions(ctx, &pageID)
	if err != nil {
		return 0, err
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	for _, version := range versions {
		if err := reindexPublishedDocTx(ctx, tx, version.DocID); err != nil {
			return 0, err
		}
	}

	if err := assetref.MarkPublishedBackfilled(ctx, tx, pageID, time.Now().UTC()); err != nil {
		return 0, err
	}
	if _, err := assetref.RecomputeCleanupEligibility(ctx, tx, pageID); err != nil {
		return 0, err
	}
	return len(versions), tx.Commit(ctx)
}

func BackfillAllPublishedDocs(ctx context.Context) (PublishedBackfillResult, error) {
	pages, err := listActiveDocumentPages(ctx)
	if err != nil {
		return PublishedBackfillResult{}, err
	}
	versions, err := listPublishedDocVersions(ctx, nil)
	if err != nil {
		return PublishedBackfillResult{}, err
	}

	grouped := make(map[int64][]PublishedDocVersion, len(pages))
	for _, version := range versions {
		grouped[version.PageID] = append(grouped[version.PageID], version)
	}

	result := PublishedBackfillResult{}
	for _, pageID := range pages {
		pageVersions := grouped[pageID]
		result.Scanned += len(pageVersions)

		tx, err := core.GetPool().Begin(ctx)
		if err != nil {
			return result, err
		}

		pageErr := error(nil)
		for _, version := range pageVersions {
			if err := reindexPublishedDocTx(ctx, tx, version.DocID); err != nil {
				pageErr = fmt.Errorf("reindex published doc %d: %w", version.DocID, err)
				break
			}
		}
		if pageErr == nil {
			if err := assetref.MarkPublishedBackfilled(ctx, tx, pageID, time.Now().UTC()); err != nil {
				pageErr = err
			}
		}
		if pageErr == nil {
			if _, err := assetref.RecomputeCleanupEligibility(ctx, tx, pageID); err != nil {
				pageErr = err
			}
		}
		if pageErr != nil {
			tx.Rollback(ctx)
			result.Failed += max(1, len(pageVersions))
			core.Logger.Error("asset cleanup: published backfill failed", zap.Error(pageErr), zap.Int64("page_id", pageID))
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		result.Updated += len(pageVersions)
	}

	return result, nil
}

func loadCommentReplyAttachmentRows(ctx context.Context) ([]commentReplyAttachmentRow, error) {
	rows, err := core.GetPool().Query(ctx, listCommentReplyAttachmentsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (commentReplyAttachmentRow, error) {
		var rec commentReplyAttachmentRow
		err := row.Scan(&rec.ReplyID, &rec.PageID, &rec.AttachmentIDs)
		return rec, err
	})
}

func BackfillCommentReplyReferences(ctx context.Context) (CommentBackfillResult, error) {
	pages, err := listActiveDocumentPages(ctx)
	if err != nil {
		return CommentBackfillResult{}, err
	}
	replyRows, err := loadCommentReplyAttachmentRows(ctx)
	if err != nil {
		return CommentBackfillResult{}, err
	}

	pageFailures := make(map[int64]struct{})
	result := CommentBackfillResult{Replies: len(replyRows)}
	for _, replyRow := range replyRows {
		tx, err := core.GetPool().Begin(ctx)
		if err != nil {
			return result, err
		}

		refs, err := assetref.NormalizePayloadReferences(ctx, tx, replyRow.PageID, &assetref.PayloadReferences{
			Attachments: replyRow.AttachmentIDs,
		})
		if err == nil {
			err = assetref.ReplaceCommentReplyReferences(ctx, tx, replyRow.PageID, replyRow.ReplyID, refs)
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		if err != nil {
			result.Failed++
			pageFailures[replyRow.PageID] = struct{}{}
			core.Logger.Error("asset cleanup: comment backfill failed", zap.Error(err), zap.String("reply_id", replyRow.ReplyID), zap.Int64("page_id", replyRow.PageID))
			continue
		}
		result.Updated++
	}

	now := time.Now().UTC()
	for _, pageID := range pages {
		if _, failed := pageFailures[pageID]; failed {
			continue
		}
		tx, err := core.GetPool().Begin(ctx)
		if err != nil {
			return result, err
		}
		if err := assetref.MarkCommentBackfilled(ctx, tx, pageID, now); err != nil {
			tx.Rollback(ctx)
			core.Logger.Error("asset cleanup: mark comment coverage failed", zap.Error(err), zap.Int64("page_id", pageID))
			return result, err
		}
		if _, err := assetref.RecomputeCleanupEligibility(ctx, tx, pageID); err != nil {
			tx.Rollback(ctx)
			core.Logger.Error("asset cleanup: recompute eligibility after comment backfill failed", zap.Error(err), zap.Int64("page_id", pageID))
			return result, err
		}
		if err := tx.Commit(ctx); err != nil {
			core.Logger.Error("asset cleanup: commit comment coverage failed", zap.Error(err), zap.Int64("page_id", pageID))
			return result, err
		}
	}

	return result, nil
}

func ClassifyDraftCoverage(ctx context.Context) (DraftCoverageResult, error) {
	pages, err := listActiveDocumentPages(ctx)
	if err != nil {
		return DraftCoverageResult{}, err
	}
	draftRows, err := core.GetPool().Query(ctx, listPagesWithActiveDraftQuery)
	if err != nil {
		return DraftCoverageResult{}, err
	}
	defer draftRows.Close()

	draftPages, err := pgx.CollectRows(draftRows, func(row pgx.CollectableRow) (int64, error) {
		var pageID int64
		err := row.Scan(&pageID)
		return pageID, err
	})
	if err != nil {
		return DraftCoverageResult{}, err
	}

	draftSet := make(map[int64]struct{}, len(draftPages))
	for _, pageID := range draftPages {
		draftSet[pageID] = struct{}{}
	}

	result := DraftCoverageResult{}
	for _, pageID := range pages {
		tx, err := core.GetPool().Begin(ctx)
		if err != nil {
			return result, err
		}

		if _, hasDraft := draftSet[pageID]; hasDraft {
			if err := assetref.SetDraftStatus(ctx, tx, pageID, assetref.DraftStatusBlockedBinaryDraft, time.Now().UTC()); err != nil {
				tx.Rollback(ctx)
				core.Logger.Error("asset cleanup: set draft coverage failed", zap.Error(err), zap.Int64("page_id", pageID))
				return result, err
			}
			result.BlockedDraftPages++
		}

		eligible, err := assetref.RecomputeCleanupEligibility(ctx, tx, pageID)
		if err != nil {
			tx.Rollback(ctx)
			core.Logger.Error("asset cleanup: recompute eligibility after draft classification failed", zap.Error(err), zap.Int64("page_id", pageID))
			return result, err
		}
		if eligible {
			result.EligiblePages++
		}
		if err := tx.Commit(ctx); err != nil {
			core.Logger.Error("asset cleanup: commit draft classification failed", zap.Error(err), zap.Int64("page_id", pageID))
			return result, err
		}
	}

	return result, nil
}
