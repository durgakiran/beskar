package assetcleanup

const (
	listPublishedDocVersionsQuery = `SELECT d.doc_id, d.page_id, p.space_id
FROM core.page_doc_map d
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
WHERE d.draft = 0
  AND s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document'
ORDER BY d.page_id ASC, d.version ASC, d.doc_id ASC`

	listPublishedDocVersionsByPageQuery = `SELECT d.doc_id, d.page_id, p.space_id
FROM core.page_doc_map d
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
WHERE d.page_id = $1
  AND d.draft = 0
  AND s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document'
ORDER BY d.version ASC, d.doc_id ASC`

	getPublishedDocVersionMetaQuery = `SELECT d.doc_id, d.page_id, p.space_id
FROM core.page_doc_map d
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
WHERE d.doc_id = $1
  AND d.draft = 0
  AND s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document'`

	getPublishedDocNodesByDocIDQuery = `SELECT
    c.doc_id AS docId,
    c.id AS contentId,
    c.parent_id AS parentId,
    c."order" AS "order",
    c.type AS type,
    c.attrs AS attrs,
    c.marks AS marks
FROM core.content c
WHERE c.doc_id = $1`

	getPublishedTextNodesByDocIDQuery = `SELECT
    t.doc_id AS docId,
    t.parent_id AS parentId,
    t."order" AS "order",
    t.marks AS marks,
    t.text AS text
FROM core.text_node t
WHERE t.doc_id = $1`

	listCommentReplyAttachmentsQuery = `SELECT
    r.id::text AS reply_id,
    t.document_id::bigint AS page_id,
    ARRAY_AGG(cra.attachment_id::text ORDER BY cra.attachment_id) AS attachment_ids
FROM core.comment_reply_attachments cra
JOIN core.comment_replies r ON r.id = cra.reply_id
JOIN core.comment_threads t ON t.id = r.thread_id
JOIN core.page p ON p.id = t.document_id::bigint
JOIN core.space s ON s.id = p.space_id
WHERE s.deleted_at IS NULL
GROUP BY r.id, t.document_id
ORDER BY r.id`

	listPagesWithActiveDraftQuery = `SELECT DISTINCT d.page_id
FROM core.page_doc_map d
JOIN core.content_draft cd ON cd.doc_id = d.doc_id
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
WHERE d.draft = 1
  AND s.deleted_at IS NULL
ORDER BY d.page_id`

	listActiveDocumentPagesQuery = `SELECT p.id
FROM core.page p
JOIN core.space s ON s.id = p.space_id
WHERE s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document'
ORDER BY p.id`

	listCleanupEligiblePagesQuery = `SELECT c.page_id
FROM core.asset_reference_coverage c
JOIN core.page p ON p.id = c.page_id
JOIN core.space s ON s.id = p.space_id
WHERE c.cleanup_eligible = true
  AND s.deleted_at IS NULL
ORDER BY c.page_id
LIMIT $1`

	listPageAttachmentAssetsQuery = `SELECT
    'attachment' AS asset_type,
    a.id::text AS asset_id,
    a.page_id,
    p.space_id,
    a.file_size,
    a.storage_path AS storage_key,
    a.orphaned_at,
    a.deleted_at,
    a.purged_at
FROM core.attachment a
JOIN core.page p ON p.id = a.page_id
JOIN core.space s ON s.id = p.space_id
WHERE a.page_id = $1
  AND a.deleted_at IS NULL
  AND s.deleted_at IS NULL
ORDER BY a.created_at ASC, a.id ASC`

	listPageImageAssetsQuery = `SELECT
    'image' AS asset_type,
    i.id::text AS asset_id,
    i.page_id,
    p.space_id,
    i.file_size,
    i.storage_key,
    i.orphaned_at,
    i.deleted_at,
    i.purged_at
FROM core.image_asset i
JOIN core.page p ON p.id = i.page_id
JOIN core.space s ON s.id = p.space_id
WHERE i.page_id = $1
  AND i.deleted_at IS NULL
  AND s.deleted_at IS NULL
ORDER BY i.created_at ASC, i.id ASC`

	listLiveReferencesByPageQuery = `SELECT asset_type, asset_id
FROM core.asset_reference
WHERE page_id = $1`

	clearAttachmentOrphanedAtQuery = `UPDATE core.attachment
SET orphaned_at = NULL
WHERE id = $1::uuid
  AND deleted_at IS NULL`

	clearImageOrphanedAtQuery = `UPDATE core.image_asset
SET orphaned_at = NULL
WHERE id = $1::uuid
  AND deleted_at IS NULL`

	markAttachmentOrphanedAtQuery = `UPDATE core.attachment
SET orphaned_at = $2
WHERE id = $1::uuid
  AND deleted_at IS NULL
  AND orphaned_at IS NULL`

	markImageOrphanedAtQuery = `UPDATE core.image_asset
SET orphaned_at = $2
WHERE id = $1::uuid
  AND deleted_at IS NULL
  AND orphaned_at IS NULL`

	softDeleteAttachmentQuery = `UPDATE core.attachment
SET deleted_at = $2,
    orphaned_at = COALESCE(orphaned_at, $2)
WHERE id = $1::uuid
  AND deleted_at IS NULL`

	softDeleteImageQuery = `UPDATE core.image_asset
SET deleted_at = $2,
    orphaned_at = COALESCE(orphaned_at, $2)
WHERE id = $1::uuid
  AND deleted_at IS NULL`

	listAttachmentPurgeCandidatesQuery = `SELECT
    'attachment' AS asset_type,
    a.id::text AS asset_id,
    a.page_id,
    p.space_id,
    a.file_size,
    a.storage_path AS storage_key,
    a.orphaned_at,
    a.deleted_at,
    a.purged_at
FROM core.attachment a
JOIN core.page p ON p.id = a.page_id
JOIN core.space s ON s.id = p.space_id
WHERE a.deleted_at IS NOT NULL
  AND a.orphaned_at IS NOT NULL
  AND a.purged_at IS NULL
  AND a.deleted_at <= $1
  AND s.deleted_at IS NULL
ORDER BY a.deleted_at ASC, a.id ASC
LIMIT $2`

	listImagePurgeCandidatesQuery = `SELECT
    'image' AS asset_type,
    i.id::text AS asset_id,
    i.page_id,
    p.space_id,
    i.file_size,
    i.storage_key,
    i.orphaned_at,
    i.deleted_at,
    i.purged_at
FROM core.image_asset i
JOIN core.page p ON p.id = i.page_id
JOIN core.space s ON s.id = p.space_id
WHERE i.deleted_at IS NOT NULL
  AND i.orphaned_at IS NOT NULL
  AND i.purged_at IS NULL
  AND i.deleted_at <= $1
  AND s.deleted_at IS NULL
ORDER BY i.deleted_at ASC, i.id ASC
LIMIT $2`

	countLiveRefsForAssetQuery = `SELECT COUNT(*)
FROM core.asset_reference
WHERE asset_type = $1
  AND asset_id = $2`

	setAttachmentPurgedAtQuery = `UPDATE core.attachment
SET purged_at = $2
WHERE id = $1::uuid
  AND purged_at IS NULL`

	setImagePurgedAtQuery = `UPDATE core.image_asset
SET purged_at = $2
WHERE id = $1::uuid
  AND purged_at IS NULL`

	getAttachmentForRestoreQuery = `SELECT
    a.id::text,
    a.page_id,
    p.space_id,
    a.file_size,
    a.deleted_at,
    a.purged_at
FROM core.attachment a
JOIN core.page p ON p.id = a.page_id
JOIN core.space s ON s.id = p.space_id
WHERE a.id = $1::uuid
  AND s.deleted_at IS NULL`

	getImageForRestoreQuery = `SELECT
    i.id::text,
    i.page_id,
    p.space_id,
    i.file_size,
    i.deleted_at,
    i.purged_at
FROM core.image_asset i
JOIN core.page p ON p.id = i.page_id
JOIN core.space s ON s.id = p.space_id
WHERE i.id = $1::uuid
  AND s.deleted_at IS NULL`

	restoreAttachmentQuery = `UPDATE core.attachment
SET orphaned_at = NULL,
    deleted_at = NULL
WHERE id = $1::uuid
  AND deleted_at IS NOT NULL`

	restoreImageQuery = `UPDATE core.image_asset
SET orphaned_at = NULL,
    deleted_at = NULL
WHERE id = $1::uuid
  AND deleted_at IS NOT NULL`
)
