package quota

const (
	getAccountForUserQuery = `SELECT id
FROM billing.account
WHERE user_id = $1`

	ensureSpaceUsageRowQuery = `INSERT INTO billing.space_usage (space_id, storage_bytes_used, storage_bytes_reserved, updated_at)
VALUES ($1, 0, 0, now())
ON CONFLICT (space_id) DO NOTHING`

	getPageQuotaContextQuery = `SELECT p.id, p.space_id, s.account_id
FROM core.page p
JOIN core.space s ON s.id = p.space_id
WHERE p.id = $1 AND s.deleted_at IS NULL`

	getAccountUsageRowsForUpdateQuery = `SELECT
    u.space_id,
    u.storage_bytes_used,
    u.storage_bytes_reserved
FROM billing.space_usage u
JOIN core.space s ON s.id = u.space_id
WHERE s.account_id = $1 AND s.deleted_at IS NULL
FOR UPDATE OF u`

	getAccountUsageQuery = `SELECT
    a.id,
    a.user_id,
    COALESCE(stats.space_count, 0) AS space_count,
    COALESCE(stats.storage_bytes_used, 0) AS storage_bytes_used,
    COALESCE(stats.storage_bytes_reserved, 0) AS storage_bytes_reserved
FROM billing.account a
LEFT JOIN (
    SELECT
        s.account_id,
        COUNT(*) AS space_count,
        COALESCE(SUM(u.storage_bytes_used), 0) AS storage_bytes_used,
        COALESCE(SUM(u.storage_bytes_reserved), 0) AS storage_bytes_reserved
    FROM core.space s
    LEFT JOIN billing.space_usage u ON u.space_id = s.id
    WHERE s.deleted_at IS NULL
    GROUP BY s.account_id
) stats ON stats.account_id = a.id
WHERE a.id = $1`

	getSpaceUsageQuery = `SELECT
    s.id,
    s.account_id,
    COALESCE(u.storage_bytes_used, 0) AS storage_bytes_used,
    COALESCE(u.storage_bytes_reserved, 0) AS storage_bytes_reserved
FROM core.space s
LEFT JOIN billing.space_usage u ON u.space_id = s.id
WHERE s.id = $1 AND s.deleted_at IS NULL`

	getAccountReconciledStorageQuery = `SELECT
    COALESCE((
        SELECT SUM(a.file_size)
        FROM core.attachment a
        JOIN core.page p ON p.id = a.page_id
        JOIN core.space s ON s.id = p.space_id
        WHERE s.account_id = $1 AND s.deleted_at IS NULL AND a.deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(i.file_size)
        FROM core.image_asset i
        JOIN core.page p ON p.id = i.page_id
        JOIN core.space s ON s.id = p.space_id
        WHERE s.account_id = $1 AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(w.file_size)
        FROM core.whiteboard_asset w
        JOIN core.page p ON p.id = w.page_id
        JOIN core.space s ON s.id = p.space_id
        WHERE s.account_id = $1 AND s.deleted_at IS NULL
    ), 0)`

	getSpaceReconciledStorageQuery = `SELECT
    COALESCE((
        SELECT SUM(a.file_size)
        FROM core.attachment a
        JOIN core.page p ON p.id = a.page_id
        WHERE p.space_id = $1 AND a.deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(i.file_size)
        FROM core.image_asset i
        JOIN core.page p ON p.id = i.page_id
        WHERE p.space_id = $1 AND i.deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(w.file_size)
        FROM core.whiteboard_asset w
        JOIN core.page p ON p.id = w.page_id
        WHERE p.space_id = $1
    ), 0)`

	getActiveSubscriptionQuery = `SELECT
    s.id,
    s.account_id,
    s.plan_id,
    s.status,
    s.effective_from,
    s.effective_to,
    s.source,
    p.code
FROM billing.account_subscription s
JOIN billing.plan p ON p.id = s.plan_id
WHERE s.account_id = $1
  AND (s.effective_to IS NULL OR s.effective_to > now())
ORDER BY
    CASE
        WHEN lower(s.status) IN ('active', 'trialing', 'grace_period') THEN 0
        ELSE 1
    END,
    s.effective_from DESC,
    s.created_at DESC
LIMIT 1`

	getPlanLimitsQuery = `SELECT metric_key, limit_value, limit_unit, enforcement_mode
FROM billing.plan_limit
WHERE plan_id = $1`

	getActiveDocumentHistoryRetentionDaysQuery = `SELECT COALESCE(pl.limit_value, $2)::bigint
FROM billing.account_subscription s
JOIN billing.plan p ON p.id = s.plan_id
LEFT JOIN billing.plan_limit pl
  ON pl.plan_id = s.plan_id
 AND pl.metric_key = 'document_history_retention_days'
 AND pl.limit_value > 0
 AND pl.limit_unit = 'days'
WHERE s.account_id = $1
  AND lower(s.status) = 'active'
  AND (s.effective_to IS NULL OR s.effective_to > now())
ORDER BY
    s.effective_from DESC,
    s.created_at DESC
LIMIT 1`

	updateSpaceUsageReserveQuery = `UPDATE billing.space_usage
SET storage_bytes_reserved = storage_bytes_reserved + $2,
    updated_at = now()
WHERE space_id = $1`

	updateSpaceUsageCommitQuery = `UPDATE billing.space_usage
SET storage_bytes_reserved = GREATEST(storage_bytes_reserved - $2, 0),
    storage_bytes_used = storage_bytes_used + $2,
    updated_at = now()
WHERE space_id = $1`

	updateSpaceUsageReleaseQuery = `UPDATE billing.space_usage
SET storage_bytes_reserved = GREATEST(storage_bytes_reserved - $2, 0),
    updated_at = now()
WHERE space_id = $1`

	updateSpaceUsageUsedDeltaQuery = `UPDATE billing.space_usage
SET storage_bytes_used = GREATEST(storage_bytes_used + $2, 0),
    updated_at = now()
WHERE space_id = $1`

	insertSpaceUsageEventQuery = `INSERT INTO billing.space_usage_event
    (space_id, metric_key, event_type, delta_value, source_type, source_id, correlation_id, metadata, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`

	getPendingInviteCountQuery = `SELECT COUNT(*)
FROM notifications.invites
WHERE entity = 'space' AND entity_id = $1 AND status IS NULL`

	getPageStorageBytesQuery = `SELECT
    COALESCE((
        SELECT SUM(file_size)
        FROM core.attachment
        WHERE page_id = $1 AND deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(file_size)
        FROM core.image_asset
        WHERE page_id = $1 AND deleted_at IS NULL
    ), 0)
    +
    COALESCE((
        SELECT SUM(file_size)
        FROM core.whiteboard_asset
        WHERE page_id = $1
    ), 0)`

	getSpaceUsageStateForUpdateQuery = `SELECT
    s.account_id,
    u.storage_bytes_used,
    u.storage_bytes_reserved,
    u.updated_at,
    u.last_reconciled_at
FROM core.space s
JOIN billing.space_usage u ON u.space_id = s.id
WHERE s.id = $1 AND s.deleted_at IS NULL
FOR UPDATE OF u`

	updateSpaceUsageReconcileQuery = `UPDATE billing.space_usage
SET storage_bytes_used = $2,
    last_reconciled_at = now(),
    updated_at = now()
WHERE space_id = $1`

	updateSpaceUsageLastReconciledQuery = `UPDATE billing.space_usage
SET last_reconciled_at = now()
WHERE space_id = $1`

	getAllActiveSpaceIDsQuery = `SELECT id
FROM core.space
WHERE deleted_at IS NULL
ORDER BY id`

	getAllSpaceUsageStatesQuery = `SELECT
    s.id,
    s.account_id,
    COALESCE(u.storage_bytes_used, 0) AS storage_bytes_used,
    COALESCE(u.storage_bytes_reserved, 0) AS storage_bytes_reserved,
    u.updated_at,
    u.last_reconciled_at
FROM core.space s
LEFT JOIN billing.space_usage u ON u.space_id = s.id
WHERE s.deleted_at IS NULL
ORDER BY s.id`
)
