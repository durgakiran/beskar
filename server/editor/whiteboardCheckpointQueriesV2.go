package editor

const (
	whiteboardV2CheckpointLockBoard = `SELECT w.page_id FROM whiteboard.whiteboard w
 JOIN core.page p ON p.id = w.page_id
 WHERE w.page_id = $1 AND p.space_id = $2 FOR SHARE OF p, w`
	whiteboardV2CheckpointLockDraft = `SELECT head_sequence, restore_generation FROM whiteboard.whiteboard_draft
 WHERE page_id = $1 FOR UPDATE`
	whiteboardV2CheckpointReceipt = `SELECT id, sequence, request_hash FROM whiteboard.whiteboard_update
 WHERE page_id = $1 AND actor_id = $2 AND idempotency_key = $3`
	whiteboardV2CheckpointInsert = `INSERT INTO whiteboard.whiteboard_update
 (id, page_id, sequence, actor_id, idempotency_key, update_bytes, update_encoding, request_hash)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	whiteboardV2CheckpointAdvance = `UPDATE whiteboard.whiteboard_draft
 SET head_sequence = $2, updated_by = $3, updated_at = now() WHERE page_id = $1`
)
