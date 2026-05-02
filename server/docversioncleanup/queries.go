package docversioncleanup

const publishedDocCoveragePreflightQuery = `WITH published_pages AS (
    SELECT DISTINCT d.page_id
    FROM core.page_doc_map d
    JOIN core.page p ON p.id = d.page_id
    JOIN core.space s ON s.id = p.space_id
    WHERE d.draft = 0
      AND s.deleted_at IS NULL
      AND COALESCE(p.type, 'document') = 'document'
)
SELECT
    COUNT(*) AS checked_page_count,
    COUNT(*) FILTER (
        WHERE c.page_id IS NULL
           OR c.published_backfilled_at IS NULL
    ) AS missing_page_count
FROM published_pages pp
LEFT JOIN core.asset_reference_coverage c ON c.page_id = pp.page_id`

const listCandidateVersionsQuery = `WITH latest_published AS (
    SELECT DISTINCT ON (page_id)
        doc_id,
        page_id
    FROM core.page_doc_map
    WHERE draft = 0
    ORDER BY page_id, version DESC, doc_id DESC
)
SELECT
    d.doc_id,
    d.page_id,
    p.space_id,
    s.account_id,
    COALESCE(active_plan.plan_id::text, '') AS plan_id,
    COALESCE(active_plan.plan_code, '') AS plan_code,
    d.version,
    COALESCE(pl.limit_value::integer, $1) AS retention_days,
    now() - make_interval(days => COALESCE(pl.limit_value::integer, $1)) AS retention_cutoff
FROM core.page_doc_map d
JOIN core.page p ON p.id = d.page_id
JOIN core.space s ON s.id = p.space_id
LEFT JOIN LATERAL (
    SELECT sub.plan_id, bp.code AS plan_code
    FROM billing.account_subscription sub
    JOIN billing.plan bp ON bp.id = sub.plan_id
    WHERE sub.account_id = s.account_id
      AND lower(sub.status) = 'active'
      AND (sub.effective_to IS NULL OR sub.effective_to > now())
    ORDER BY sub.effective_from DESC, sub.created_at DESC
    LIMIT 1
) active_plan ON true
LEFT JOIN billing.plan_limit pl
  ON pl.plan_id = active_plan.plan_id
 AND pl.metric_key = 'document_history_retention_days'
 AND pl.limit_value > 0
 AND pl.limit_unit = 'days'
LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
WHERE d.draft = 0
  AND d.version < (
    now() - make_interval(days => COALESCE(pl.limit_value::integer, $1))
  )
  AND lp.doc_id IS NULL
  AND s.deleted_at IS NULL
  AND COALESCE(p.type, 'document') = 'document'
ORDER BY d.version ASC, d.doc_id ASC
LIMIT $2`

const dryRunImpactQuery = `WITH latest_published AS (
    SELECT DISTINCT ON (page_id)
        doc_id,
        page_id
    FROM core.page_doc_map
    WHERE draft = 0
    ORDER BY page_id, version DESC, doc_id DESC
),
candidates AS (
    SELECT
        d.doc_id,
        d.page_id,
        s.account_id,
        COALESCE(active_plan.plan_code, '') AS plan_code,
        d.version
    FROM core.page_doc_map d
    JOIN core.page p ON p.id = d.page_id
    JOIN core.space s ON s.id = p.space_id
    LEFT JOIN LATERAL (
        SELECT sub.plan_id, bp.code AS plan_code
        FROM billing.account_subscription sub
        JOIN billing.plan bp ON bp.id = sub.plan_id
        WHERE sub.account_id = s.account_id
          AND lower(sub.status) = 'active'
          AND (sub.effective_to IS NULL OR sub.effective_to > now())
        ORDER BY sub.effective_from DESC, sub.created_at DESC
        LIMIT 1
    ) active_plan ON true
    LEFT JOIN billing.plan_limit pl
      ON pl.plan_id = active_plan.plan_id
     AND pl.metric_key = 'document_history_retention_days'
     AND pl.limit_value > 0
     AND pl.limit_unit = 'days'
    LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
    WHERE d.draft = 0
      AND d.version < (
        now() - make_interval(days => COALESCE(pl.limit_value::integer, $1))
      )
      AND lp.doc_id IS NULL
      AND s.deleted_at IS NULL
      AND COALESCE(p.type, 'document') = 'document'
    ORDER BY d.version ASC, d.doc_id ASC
    LIMIT $2
),
candidate_counts AS (
    SELECT
        c.*,
        (SELECT COUNT(*) FROM core.content content WHERE content.doc_id = c.doc_id) AS content_node_count,
        (SELECT COUNT(*) FROM core.text_node text_node WHERE text_node.doc_id = c.doc_id) AS text_node_count,
        (
            SELECT COUNT(*)
            FROM core.asset_reference ar
            WHERE ar.source_kind = 'published_doc'
              AND ar.source_id = c.doc_id::text
        ) AS asset_reference_count
    FROM candidates c
)
SELECT
    $1::integer AS fallback_retention_days,
    COALESCE(
        STRING_AGG(DISTINCT plan_code, ',' ORDER BY plan_code) FILTER (WHERE plan_code <> ''),
        ''
    ) AS affected_plan_codes,
    COUNT(*) AS candidate_version_count,
    COUNT(DISTINCT page_id) AS affected_page_count,
    COUNT(DISTINCT account_id) AS affected_account_count,
    MIN(version) AS oldest_candidate_version,
    MAX(version) AS newest_candidate_version,
    COALESCE(SUM(content_node_count), 0) AS estimated_content_rows,
    COALESCE(SUM(text_node_count), 0) AS estimated_text_node_rows,
    COALESCE(SUM(asset_reference_count), 0) AS estimated_asset_reference_rows
FROM candidate_counts`

const lockNextPagePruneCandidatesQuery = `WITH latest_published AS (
    SELECT DISTINCT ON (page_id)
        doc_id,
        page_id
    FROM core.page_doc_map
    WHERE draft = 0
    ORDER BY page_id, version DESC, doc_id DESC
),
target_page AS (
    SELECT d.page_id
    FROM core.page_doc_map d
    JOIN core.page p ON p.id = d.page_id
    JOIN core.space s ON s.id = p.space_id
    LEFT JOIN LATERAL (
        SELECT sub.plan_id
        FROM billing.account_subscription sub
        WHERE sub.account_id = s.account_id
          AND lower(sub.status) = 'active'
          AND (sub.effective_to IS NULL OR sub.effective_to > now())
        ORDER BY sub.effective_from DESC, sub.created_at DESC
        LIMIT 1
    ) active_plan ON true
    LEFT JOIN billing.plan_limit pl
      ON pl.plan_id = active_plan.plan_id
     AND pl.metric_key = 'document_history_retention_days'
     AND pl.limit_value > 0
     AND pl.limit_unit = 'days'
    LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
    WHERE d.draft = 0
      AND d.version < (
        now() - make_interval(days => COALESCE(pl.limit_value::integer, $1))
      )
      AND lp.doc_id IS NULL
      AND s.deleted_at IS NULL
      AND COALESCE(p.type, 'document') = 'document'
    ORDER BY d.version ASC, d.doc_id ASC
    LIMIT 1
),
locked_candidates AS (
    SELECT
        d.doc_id,
        d.page_id,
        p.space_id,
        s.account_id,
        COALESCE(active_plan.plan_id::text, '') AS plan_id,
        COALESCE(active_plan.plan_code, '') AS plan_code,
        d.version,
        COALESCE(pl.limit_value::integer, $1) AS retention_days,
        now() - make_interval(days => COALESCE(pl.limit_value::integer, $1)) AS retention_cutoff
    FROM core.page_doc_map d
    JOIN target_page tp ON tp.page_id = d.page_id
    JOIN core.page p ON p.id = d.page_id
    JOIN core.space s ON s.id = p.space_id
    LEFT JOIN LATERAL (
        SELECT sub.plan_id, bp.code AS plan_code
        FROM billing.account_subscription sub
        JOIN billing.plan bp ON bp.id = sub.plan_id
        WHERE sub.account_id = s.account_id
          AND lower(sub.status) = 'active'
          AND (sub.effective_to IS NULL OR sub.effective_to > now())
        ORDER BY sub.effective_from DESC, sub.created_at DESC
        LIMIT 1
    ) active_plan ON true
    LEFT JOIN billing.plan_limit pl
      ON pl.plan_id = active_plan.plan_id
     AND pl.metric_key = 'document_history_retention_days'
     AND pl.limit_value > 0
     AND pl.limit_unit = 'days'
    LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
    WHERE d.draft = 0
      AND d.version < (
        now() - make_interval(days => COALESCE(pl.limit_value::integer, $1))
      )
      AND lp.doc_id IS NULL
      AND s.deleted_at IS NULL
      AND COALESCE(p.type, 'document') = 'document'
    ORDER BY d.version ASC, d.doc_id ASC
    LIMIT $2
    FOR UPDATE OF d SKIP LOCKED
)
SELECT
    lc.doc_id,
    lc.page_id,
    lc.space_id,
    lc.account_id,
    lc.plan_id,
    lc.plan_code,
    lc.version,
    lc.retention_days,
    lc.retention_cutoff,
    (SELECT COUNT(*) FROM core.content c WHERE c.doc_id = lc.doc_id) AS content_node_count,
    (SELECT COUNT(*) FROM core.text_node t WHERE t.doc_id = lc.doc_id) AS text_node_count,
    (
        SELECT COUNT(*)
        FROM core.asset_reference ar
        WHERE ar.source_kind = 'published_doc'
          AND ar.source_id = lc.doc_id::text
    ) AS asset_reference_count
FROM locked_candidates lc
ORDER BY lc.version ASC, lc.doc_id ASC`

const insertCleanupLogQuery = `INSERT INTO core.document_version_cleanup_log
    (doc_id, page_id, space_id, account_id, plan_id, plan_code, version, reason, retention_days, retention_cutoff, content_node_count, text_node_count, asset_reference_count, job_run_id)
VALUES
    ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14)`

const deletePublishedDocAssetReferencesQuery = `DELETE FROM core.asset_reference
WHERE source_kind = 'published_doc'
  AND source_id = $1`

const deletePageDocMapQuery = `DELETE FROM core.page_doc_map
WHERE doc_id = $1`

const isDocStillPrunableQuery = `WITH latest_published AS (
    SELECT DISTINCT ON (page_id)
        doc_id,
        page_id
    FROM core.page_doc_map
    WHERE draft = 0
      AND page_id = (
          SELECT page_id
          FROM core.page_doc_map
          WHERE doc_id = $1
      )
    ORDER BY page_id, version DESC, doc_id DESC
)
SELECT EXISTS (
    SELECT 1
    FROM core.page_doc_map d
    JOIN core.page p ON p.id = d.page_id
    JOIN core.space s ON s.id = p.space_id
    LEFT JOIN LATERAL (
        SELECT sub.plan_id
        FROM billing.account_subscription sub
        WHERE sub.account_id = s.account_id
          AND lower(sub.status) = 'active'
          AND (sub.effective_to IS NULL OR sub.effective_to > now())
        ORDER BY sub.effective_from DESC, sub.created_at DESC
        LIMIT 1
    ) active_plan ON true
    LEFT JOIN billing.plan_limit pl
      ON pl.plan_id = active_plan.plan_id
     AND pl.metric_key = 'document_history_retention_days'
     AND pl.limit_value > 0
     AND pl.limit_unit = 'days'
    LEFT JOIN latest_published lp ON lp.doc_id = d.doc_id
    WHERE d.doc_id = $1
      AND d.draft = 0
      AND d.version < (
        now() - make_interval(days => COALESCE(pl.limit_value::integer, $2))
      )
      AND lp.doc_id IS NULL
      AND s.deleted_at IS NULL
      AND COALESCE(p.type, 'document') = 'document'
)`
