package editor

const (
	whiteboardV2PublishLockBoard = `SELECT w.page_id FROM whiteboard.whiteboard w
 JOIN core.page p ON p.id=w.page_id WHERE w.page_id=$1 AND p.space_id=$2 FOR SHARE OF p FOR UPDATE OF w`
	whiteboardV2PublishReceipt = `SELECT v.id, s.through_sequence, COALESCE((SELECT digest FROM whiteboard.whiteboard_version_preview WHERE version_id=v.id),'') FROM whiteboard.whiteboard_version v
 JOIN whiteboard.whiteboard_snapshot s ON s.page_id=v.page_id AND s.id=v.snapshot_id
 WHERE v.page_id=$1 AND v.published_by=$2 AND v.idempotency_key=$3`
	whiteboardV2PublishBase = `SELECT id, through_sequence, title, state_bytes, state_digest FROM whiteboard.whiteboard_snapshot
 WHERE page_id=$1 AND through_sequence <= $2 ORDER BY through_sequence DESC LIMIT 1`
	whiteboardV2PublishUpdates = `SELECT sequence, update_encoding, update_bytes FROM whiteboard.whiteboard_update
 WHERE page_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence`
	whiteboardV2PublishSnapshot = `INSERT INTO whiteboard.whiteboard_snapshot
 (id,page_id,through_sequence,title,state_bytes,state_digest,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	whiteboardV2PublishVersion = `INSERT INTO whiteboard.whiteboard_version
 (id,page_id,snapshot_id,version_number,published_by,idempotency_key)
 SELECT $1,$2,$3,COALESCE(MAX(version_number),0)+1,$4,$5 FROM whiteboard.whiteboard_version WHERE page_id=$2`
	whiteboardV2PublishPointer = `UPDATE whiteboard.whiteboard SET published_version_id=$2 WHERE page_id=$1`
	whiteboardV2Published      = `SELECT v.id,v.version_number,v.published_by,v.published_at,
 s.id,s.through_sequence,s.title,octet_length(s.state_bytes)::bigint,s.state_digest
 FROM whiteboard.whiteboard_version v JOIN whiteboard.whiteboard_snapshot s ON s.page_id=v.page_id AND s.id=v.snapshot_id
 WHERE v.page_id=$1 AND v.id=$2`
	whiteboardV2PublishedPointer = `SELECT w.published_version_id FROM whiteboard.whiteboard w
 JOIN core.page p ON p.id=w.page_id JOIN core.space s ON s.id=p.space_id
 WHERE w.page_id=$1 AND p.space_id=$2 AND s.deleted_at IS NULL`
)
