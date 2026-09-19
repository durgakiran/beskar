package editor

const (
	whiteboardV2SetLockTimeout = `SET LOCAL lock_timeout = '3s'`
	whiteboardV2LockRequest    = `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`
	whiteboardV2GetReceipt     = `SELECT request_hash, CASE WHEN EXISTS (SELECT 1 FROM whiteboard.whiteboard w WHERE w.page_id=r.page_id) THEN page_id ELSE 0 END FROM whiteboard.whiteboard_create_receipt r
		WHERE actor_id = $1 AND space_id = $2 AND idempotency_key = $3`
	whiteboardV2LockSpace = `SELECT archived_at IS NOT NULL, deleted_at IS NOT NULL
		FROM core.space WHERE id = $1 FOR SHARE`
	whiteboardV2LockParent     = `SELECT id FROM core.page WHERE id = $1 AND space_id = $2 FOR SHARE`
	whiteboardV2InsertBoard    = `INSERT INTO whiteboard.whiteboard (page_id, created_by) VALUES ($1, $2)`
	whiteboardV2InsertSnapshot = `INSERT INTO whiteboard.whiteboard_snapshot
		(id, page_id, through_sequence, state_bytes, state_digest, title, created_by)
		VALUES ($1, $2, 0, $3, $4, $5, $6)`
	whiteboardV2InsertDraft = `INSERT INTO whiteboard.whiteboard_draft
		(page_id, base_snapshot_id, head_sequence, updated_by) VALUES ($1, $2, 0, $3)`
	whiteboardV2InsertReceipt = `INSERT INTO whiteboard.whiteboard_create_receipt
		(actor_id, space_id, idempotency_key, request_hash, page_id) VALUES ($1, $2, $3, $4, $5)`
)
