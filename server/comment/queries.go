package comment

const (
	// INSERT_THREAD creates a new thread
	INSERT_THREAD = `
		INSERT INTO core.comment_threads (document_id, comment_id, quoted_text, created_by) 
		VALUES ($1, $2, $3, $4) 
		RETURNING id, created_at`

	// INSERT_REPLY creates a new reply
	INSERT_REPLY = `
		INSERT INTO core.comment_replies (thread_id, author_id, body) 
		VALUES ($1, $2, $3) 
		RETURNING id, created_at`

	// LIST_THREADS fetches threads and replies for a document
	LIST_THREADS = `
		SELECT
			t.id, t.comment_id, t.quoted_text,
			t.created_by, t.resolved_by, t.created_at, t.resolved_at,
			r.id AS reply_id, r.author_id, r.body, r.edited_at, r.created_at AS reply_created_at
		FROM core.comment_threads t
		LEFT JOIN core.comment_replies r ON r.thread_id = t.id
		WHERE t.document_id = $1
		  AND ($2 OR t.resolved_at IS NULL)
		ORDER BY t.created_at ASC, r.created_at ASC`

	// RESOLVE_THREAD resolves a thread natively with optimistic updates returning the full state
	RESOLVE_THREAD = `
		UPDATE core.comment_threads
		SET resolved_by = $1, resolved_at = now()
		WHERE id = $2 AND resolved_at IS NULL
		RETURNING *`

	// UNRESOLVE_THREAD removes resolution state from an active thread
	UNRESOLVE_THREAD = `
		UPDATE core.comment_threads 
		SET resolved_by = NULL, resolved_at = NULL 
		WHERE id = $1 AND resolved_at IS NOT NULL 
		RETURNING *`

	// DELETE_THREAD drops a thread (replies vanish under ON DELETE CASCADE)
	DELETE_THREAD = `
		DELETE FROM core.comment_threads WHERE id = $1`

	// FETCH_THREAD_BASIC fetches the essential metadata of a single thread for authorization validation
	FETCH_THREAD_BASIC = `
		SELECT created_by, document_id FROM core.comment_threads WHERE id = $1`

	// UPDATE_REPLY edits a reply if the requester is the original author
	UPDATE_REPLY = `
		UPDATE core.comment_replies 
		SET body = $1, edited_at = now()
		WHERE id = $2 AND author_id = $3
		RETURNING *`

	// DELETE_REPLY drops a specific reply from a thread
	DELETE_REPLY = `
		DELETE FROM core.comment_replies WHERE id = $1`

	// FETCH_REPLY_BASIC fetches the basic metadata of a reply and its thread joining document for auth
	FETCH_REPLY_BASIC = `
		SELECT r.author_id, t.document_id 
		FROM core.comment_replies r
		JOIN core.comment_threads t ON r.thread_id = t.id
		WHERE r.id = $1`
)
