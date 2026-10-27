package searchsync

// SQL is kept separate from sync orchestration and database access.
const tryLeaderLockQuery = `SELECT pg_try_advisory_lock($1,$2)`

const releaseLeaderLockQuery = `SELECT pg_advisory_unlock($1,$2)`

// Keep the pending ID literal so generic plans can use the partial index.
const nextEventQuery = `SELECT id,page_id,attempts FROM search_sync.outbox
 WHERE status_id=1 AND next_attempt_at<=statement_timestamp()
 ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`

const deleteDocumentQuery = `DELETE FROM public.documents WHERE page_id=$1`

const upsertDocumentQuery = `INSERT INTO public.documents(space_id,created_by,page_id,doc_id,title,body_text,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(page_id) DO UPDATE SET
 space_id=EXCLUDED.space_id,created_by=EXCLUDED.created_by,doc_id=EXCLUDED.doc_id,
 title=EXCLUDED.title,body_text=EXCLUDED.body_text,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`

const completeEventQuery = `UPDATE search_sync.outbox SET status_id=$2,attempts=attempts+1,completed_at=clock_timestamp(),last_error_code=NULL WHERE id=$1`

const failEventQuery = `UPDATE search_sync.outbox SET attempts=attempts+1,status_id=$2,last_error_code=$3,
 next_attempt_at=clock_timestamp()+$4::double precision*interval '1 second' WHERE id=$1 AND status_id=$5`

const enqueuePageQuery = `INSERT INTO search_sync.outbox(page_id,reason_id) VALUES($1,$2)`

const enqueueSpaceQuery = `INSERT INTO search_sync.outbox(page_id,reason_id)
 SELECT id,$2 FROM core.page WHERE space_id=$1 AND type='document' ORDER BY id`

const backfillQuery = `WITH pages AS (
 SELECT id FROM core.page WHERE id>$1 AND type='document' ORDER BY id LIMIT $2
),queued AS (
 INSERT INTO search_sync.outbox(page_id,reason_id) SELECT id,$3 FROM pages RETURNING page_id
) SELECT page_id FROM queued ORDER BY page_id`

const outboxStatusQuery = `SELECT s.name,count(*),min(o.created_at) FROM search_sync.outbox o JOIN search_sync.statuses s ON s.id=o.status_id GROUP BY s.id,s.name ORDER BY s.id`

const replayFailedQuery = `UPDATE search_sync.outbox SET status_id=$1,attempts=0,next_attempt_at=clock_timestamp(),completed_at=NULL,last_error_code=NULL WHERE status_id=$2`

const indexedPageIDsQuery = `SELECT page_id FROM public.documents WHERE page_id>$1 ORDER BY page_id LIMIT $2`
