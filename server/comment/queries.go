package comment

const (
	// INSERT_THREAD creates a new thread
	INSERT_THREAD = `
		INSERT INTO core.comment_threads (document_id, comment_id, quoted_text, anchor, published_visible, created_by)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6)
		RETURNING id, created_at`

	// INSERT_REPLY creates a new reply
	INSERT_REPLY = `
		INSERT INTO core.comment_replies (thread_id, author_id, body) 
		VALUES ($1, $2, $3) 
		RETURNING id, created_at`

	// INSERT_REPLY_ATTACHMENT links an uploaded attachment to a reply
	INSERT_REPLY_ATTACHMENT = `
		INSERT INTO core.comment_reply_attachments (reply_id, attachment_id)
		VALUES ($1, $2::uuid)`

	// DELETE_REPLY_ATTACHMENTS removes all attachment links for a reply before re-inserting
	DELETE_REPLY_ATTACHMENTS = `
		DELETE FROM core.comment_reply_attachments
		WHERE reply_id = $1`

	// LIST_THREADS fetches threads and replies for a document
	LIST_THREADS = `
		SELECT
			t.id, t.comment_id, t.quoted_text, t.anchor, t.published_visible, t.orphaned,
			t.created_by, t.resolved_by, t.created_at, t.resolved_at,
			r.id AS reply_id, r.author_id, r.body, r.edited_at, r.created_at AS reply_created_at
		FROM core.comment_threads t
		LEFT JOIN core.comment_replies r ON r.thread_id = t.id
		WHERE t.document_id = $1
		  AND ($2 OR t.resolved_at IS NULL)
		ORDER BY t.created_at ASC, r.created_at ASC`

	// LIST_REPLY_ATTACHMENTS fetches attachment metadata for a set of reply IDs
	LIST_REPLY_ATTACHMENTS = `
		SELECT cra.reply_id, a.id::text, a.file_name, a.mime_type, a.file_size,
		       '/api/v1/attachments/' || a.id::text AS url
		FROM core.comment_reply_attachments cra
		JOIN core.attachment a ON a.id = cra.attachment_id
		WHERE cra.reply_id = ANY($1::uuid[])
		  AND a.deleted_at IS NULL`

	// RESOLVE_THREAD resolves a thread natively with optimistic updates returning the full state
	RESOLVE_THREAD = `
		UPDATE core.comment_threads
		SET resolved_by = $1, resolved_at = now()
		WHERE id = $2 AND resolved_at IS NULL
		RETURNING id`

	// UNRESOLVE_THREAD removes resolution state from an active thread
	UNRESOLVE_THREAD = `
		UPDATE core.comment_threads 
		SET resolved_by = NULL, resolved_at = NULL 
		WHERE id = $1 AND resolved_at IS NOT NULL 
		RETURNING id`

	// DELETE_THREAD drops a thread (replies vanish under ON DELETE CASCADE)
	DELETE_THREAD = `
		DELETE FROM core.comment_threads WHERE id = $1`

	PROMOTE_COMMENTS = `
		UPDATE core.comment_threads
		SET published_visible = true
		WHERE document_id = $1 AND published_visible = false`

	ORPHAN_THREAD = `
		UPDATE core.comment_threads
		SET orphaned = true
		WHERE id = $1
		RETURNING id`

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
