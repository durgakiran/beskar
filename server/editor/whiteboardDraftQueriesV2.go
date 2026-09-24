package editor

const (
	whiteboardV2DraftLock = `SELECT base_snapshot_id, head_sequence, updated_by, updated_at, restore_generation
 FROM whiteboard.whiteboard_draft WHERE page_id = $1 FOR SHARE`
	whiteboardV2DraftSnapshot = `SELECT through_sequence, title, octet_length(state_bytes)::bigint, state_digest
 FROM whiteboard.whiteboard_snapshot WHERE page_id = $1 AND id = $2`
	whiteboardV2ReplayCleanup = `DELETE FROM whiteboard.whiteboard_draft_replay WHERE page_id = $1 AND expires_at <= now()`
	whiteboardV2ReplayInsert  = `INSERT INTO whiteboard.whiteboard_draft_replay
 (id, page_id, actor_id, snapshot_id, base_sequence, head_sequence, cursor_secret, expires_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '1 hour') RETURNING expires_at`
	whiteboardV2ReplayGet = `SELECT snapshot_id, base_sequence, head_sequence, cursor_secret, expires_at
 FROM whiteboard.whiteboard_draft_replay
 WHERE id = $1 AND page_id = $2 AND actor_id = $3 AND expires_at > now()`
	whiteboardV2DraftBoard = `SELECT w.page_id FROM whiteboard.whiteboard w
 JOIN core.page p ON p.id = w.page_id JOIN core.space s ON s.id = p.space_id
 WHERE w.page_id = $1 AND p.space_id = $2 AND s.deleted_at IS NULL`
	// Bound candidate metadata before computing the byte budget. The LEFT JOIN
	// returns an oversized/corrupt candidate with NULL bytes so it fails closed.
	whiteboardV2DraftUpdates = `WITH candidates AS MATERIALIZED (
 SELECT sequence, update_encoding, octet_length(update_bytes) AS size
 FROM whiteboard.whiteboard_update WHERE page_id = $1 AND sequence > $2 AND sequence <= $3
 ORDER BY sequence LIMIT $4
 ), budget AS (
 SELECT *, sum(size) OVER (ORDER BY sequence) AS total FROM candidates
 ) SELECT b.sequence, b.update_encoding, u.update_bytes, t.title FROM budget b
 LEFT JOIN whiteboard.whiteboard_update u ON u.page_id = $1 AND u.sequence = b.sequence AND b.size BETWEEN 1 AND $6
 LEFT JOIN whiteboard.whiteboard_title_update t ON t.page_id=$1 AND t.sequence=b.sequence
 WHERE b.total <= $5 OR b.sequence = (SELECT min(sequence) FROM candidates)
 ORDER BY b.sequence`
	whiteboardV2SnapshotChunk = `SELECT substring(state_bytes FROM $3::integer FOR $4::integer)
 FROM whiteboard.whiteboard_snapshot WHERE page_id = $1 AND id = $2`
)
