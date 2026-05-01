package assetref

const (
	deleteSourceReferencesQuery = `DELETE FROM core.asset_reference
WHERE source_kind = $1 AND source_id = $2`

	insertReferenceQuery = `INSERT INTO core.asset_reference
    (asset_type, asset_id, page_id, doc_id, source_kind, source_id, last_seen_at, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`

	listPageReferencesQuery = `SELECT id::text, asset_type, asset_id, page_id, doc_id, source_kind, source_id, last_seen_at, created_at, updated_at
FROM core.asset_reference
WHERE page_id = $1
ORDER BY asset_type, asset_id, source_kind, source_id`

	listAssetReferencesQuery = `SELECT id::text, asset_type, asset_id, page_id, doc_id, source_kind, source_id, last_seen_at, created_at, updated_at
FROM core.asset_reference
WHERE asset_type = $1 AND asset_id = $2
ORDER BY page_id, source_kind, source_id`

	getCoverageQuery = `SELECT page_id, published_backfilled_at, comment_backfilled_at, draft_status, draft_checked_at, cleanup_eligible, updated_at
FROM core.asset_reference_coverage
WHERE page_id = $1`

	ensureCoverageRowQuery = `INSERT INTO core.asset_reference_coverage
    (page_id, draft_status, cleanup_eligible, updated_at)
VALUES ($1, $2, false, now())
ON CONFLICT (page_id) DO NOTHING`

	updateCoveragePublishedBackfilledQuery = `UPDATE core.asset_reference_coverage
SET published_backfilled_at = $2,
    updated_at = now()
WHERE page_id = $1`

	updateCoverageCommentBackfilledQuery = `UPDATE core.asset_reference_coverage
SET comment_backfilled_at = $2,
    updated_at = now()
WHERE page_id = $1`

	updateCoverageDraftStatusQuery = `UPDATE core.asset_reference_coverage
SET draft_status = $2,
    draft_checked_at = $3,
    updated_at = now()
WHERE page_id = $1`

	updateCoverageCleanupEligibleQuery = `UPDATE core.asset_reference_coverage
SET cleanup_eligible = $2,
    updated_at = now()
WHERE page_id = $1`

	hasActiveDraftQuery = `SELECT EXISTS (
    SELECT 1
    FROM core.page_doc_map d
    JOIN core.content_draft cd ON cd.doc_id = d.doc_id
    WHERE d.page_id = $1
      AND d.draft = 1
)`

	resolveAttachmentReferenceQuery = `SELECT id::text
FROM core.attachment
WHERE id = $1::uuid
  AND page_id = $2
  AND deleted_at IS NULL`

	resolveImageReferenceQuery = `SELECT id::text
FROM core.image_asset
WHERE public_name = $1
  AND page_id = $2
  AND deleted_at IS NULL`
)
