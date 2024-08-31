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
							d.title AS title, d.owner_id AS ownerId, d.page_id id, d.doc_id AS docId, p.space_id AS spaceId
						FROM 
							core.page p, core.page_doc_map d
						WHERE 
							p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 0 AND d.owner_id = $3 ORDER BY d.version DESC LIMIT 1`
	getDocumentDataToEdit = `SELECT 
								d.title AS title, 
								d.owner_id AS ownerId, 
								d.page_id id, 
								d.doc_id AS docId, 
								p.space_id AS spaceId
							FROM 
								core.page p, core.page_doc_map d
							WHERE 
								p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 1 AND d.owner_id = $3 ORDER BY d.version DESC LIMIT 1`
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
	insertDraftDocument = `INSERT INTO core.content_draft (doc_id, data) VALUES ($1, $2) RETURNING id`
	updateDraftDocument = `UPDATE core.content_draft SET data = $2 WHERE doc_id = $1 RETURNING id`
	getDraftDocument    = `SELECT id, doc_id, data FROM core.content_draft cd WHERE cd.doc_id = $1`
	deleteDraftDocument = `DELETE FROM core.content_draft WHERE doc_id = $1`
)
