package editor

const (
	newPage        = "INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status) VALUES ($1, $2, $3, $4, $5) RETURNING id"
	newDoc         = "INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft) VALUES ($1, $2, $3, $4, $5) RETURNING doc_id"
	newContent     = "INSERT INTO core.content (id, doc_id, parent_id, \"order\", type, attrs, marks) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"
	newText        = "INSERT INTO core.text_node (doc_id, parent_id, \"order\", marks, text) VALUES ($1, $2, $3, $4, $5) RETURNING parent_id"
	getSpace       = "SELECT id, name, date_created AS dateCreated, date_updated AS dateUpdated, user_id AS userId FROM core.space WHERE id = $1"
	updateContent  = "UPDATE core.content SET parent_id = $2, \"order\" = $3, type = $4, attrs = $5, marks = $6 WHERE id = $7 AND doc_id = $1"
	deleteContent  = "DELETE FROM core.content WHERE id = $1 AND doc_id = $2"
	updateDocQuery = "UPDATE core.page_doc_map SET title = $1, version = $2, draft = $5 WHERE doc_id = $3 AND page_id = $4"
	getDocument    = `SELECT 
							d.title AS title, 
							d.owner_id AS ownerId, 
							d.page_id id, 
							d.doc_id AS docId, 
							p.space_id AS spaceId
						FROM 
							core.page p, core.page_doc_map d
						WHERE 
							p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 0 ORDER BY d.version DESC LIMIT 1`
	getDocumentDataToEdit = `SELECT 
								d.title AS title, 
								d.owner_id AS ownerId, 
								d.page_id id, 
								d.doc_id AS docId, 
								p.space_id AS spaceId
							FROM 
								core.page p, core.page_doc_map d
							WHERE 
								p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 1 ORDER BY d.version DESC LIMIT 1`
	getDocumentNodes = `SELECT 
							c.doc_id AS docId, 
							c.id AS contentId, 
							c.parent_id AS parentId, 
							c.order AS order, 
							c.type AS type, 
							c.attrs AS attrs, 
							c.marks AS marks
						FROM 
							core.content c
						WHERE c.doc_id = $1`
	getTextNodes = `SELECT 
						c.doc_id AS docId, 
						c.parent_id AS parentId, 
						c.order AS order,
						c.marks AS marks,
						c.text as text
					FROM
						core.text_node c
					WHERE c.doc_id = $1`
	insertDraftDocument = `INSERT INTO core.content_draft (doc_id, data_binary) VALUES ($1, $2) RETURNING id`
	updateDraftDocument = `UPDATE core.content_draft SET data_binary = $2 WHERE doc_id = $1 RETURNING id`
	getBinaryDocument   = `SELECT id, doc_id, data_binary as data FROM core.content_draft cd WHERE cd.doc_id = $1`
	deleteDraftDocument = `DELETE FROM core.content_draft WHERE doc_id = $1`

	// Comment queries
	createCommentQuery = `INSERT INTO core.comment (page_id, doc_id, author_id, comment_type, parent_comment_id, comment_text) 
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, page_id, doc_id, author_id, comment_type, parent_comment_id, 
		comment_text, resolved, resolved_at, resolved_by, created_at, updated_at, edited, edited_at`

	getCommentsQuery = `SELECT c.id, c.page_id, c.doc_id, c.author_id, c.comment_type, c.parent_comment_id, 
		c.comment_text, c.resolved, c.resolved_at, c.resolved_by, c.created_at, c.updated_at, c.edited, c.edited_at
		FROM core.comment c
		WHERE c.page_id = $1 AND ($2::BIGINT IS NULL OR c.doc_id = $2 OR c.doc_id IS NULL)
		ORDER BY c.created_at ASC`

	getCommentByIdQuery = `SELECT c.id, c.page_id, c.doc_id, c.author_id, c.comment_type, c.parent_comment_id, 
		c.comment_text, c.resolved, c.resolved_at, c.resolved_by, c.created_at, c.updated_at, c.edited, c.edited_at
		FROM core.comment c
		WHERE c.id = $1`

	updateCommentQuery = `UPDATE core.comment SET comment_text = $1, updated_at = now(), edited = true, edited_at = now() 
		WHERE id = $2 RETURNING id, page_id, doc_id, author_id, comment_type, parent_comment_id, 
		comment_text, resolved, resolved_at, resolved_by, created_at, updated_at, edited, edited_at`

	deleteCommentQuery = `DELETE FROM core.comment WHERE id = $1`

	resolveCommentQuery = `UPDATE core.comment SET resolved = $1, resolved_at = CASE WHEN $1 = true THEN now() ELSE NULL END, 
		resolved_by = CASE WHEN $1 = true THEN $3 ELSE NULL END, updated_at = now()
		WHERE id = $2 RETURNING id, page_id, doc_id, author_id, comment_type, parent_comment_id, 
		comment_text, resolved, resolved_at, resolved_by, created_at, updated_at, edited, edited_at`

	getCurrentPublishedDocIdQuery = `SELECT doc_id FROM core.page_doc_map WHERE page_id = $1 AND draft = 0 ORDER BY version DESC LIMIT 1`

	// Comment Reaction queries
	addReactionQuery = `INSERT INTO core.comment_reaction (comment_id, user_id, emoji) 
		VALUES ($1, $2, $3) 
		ON CONFLICT (comment_id, user_id, emoji) DO NOTHING
		RETURNING id, comment_id, user_id, emoji, created_at`

	removeReactionQuery = `DELETE FROM core.comment_reaction 
		WHERE comment_id = $1 AND user_id = $2 AND emoji = $3`

	getReactionsQuery = `SELECT cr.id, cr.comment_id, cr.user_id, cr.emoji, cr.created_at
		FROM core.comment_reaction cr
		WHERE cr.comment_id = $1
		ORDER BY cr.created_at ASC`

	getReactionsByCommentIdsQuery = `SELECT cr.id, cr.comment_id, cr.user_id, cr.emoji, cr.created_at
		FROM core.comment_reaction cr
		WHERE cr.comment_id = ANY($1::UUID[])
		ORDER BY cr.comment_id, cr.created_at ASC`
)
