package editor

const (
	newPage        = "INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status) VALUES ($1, $2, $3, $4, $5) RETURNING id"
	newDoc         = "INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft) VALUES ($1, $2, $3, $4, $5) RETURNING doc_id"
	newContent     = "INSERT INTO core.content (id, doc_id, parent_id, \"order\", type, attrs, marks) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"
	newText        = "INSERT INTO core.text_node (doc_id, parent_id, \"order\", marks, text) VALUES ($1, $2, $3, $4, $5) RETURNING parent_id"
	getSpace       = "SELECT id, name, date_created AS dateCreated, date_updated AS dateUpdated, user_id AS userId FROM core.space WHERE id = $1"
	updateContent  = "UPDATE core.content SET parent_id = $2, \"order\" = $3, type = $4, attrs = $5, marks = $6 WHERE id = $7 AND doc_id = $1"
	deleteContent  = "DELETE FROM core.content WHERE id = $1 AND doc_id = $2"
	updateDocQuery = `UPDATE core.page_doc_map SET title = $1, version = $2, draft = $5,
		draft_generation = CASE WHEN $5::smallint = 1 THEN draft_generation + 1 ELSE draft_generation END
		WHERE doc_id = $3 AND page_id = $4 RETURNING draft_generation`
	getDocumentDataToEdit = `SELECT 
								d.title AS title, 
								d.owner_id AS ownerId, 
								d.page_id id, 
								d.doc_id AS docId, 
								d.draft_generation AS draftGeneration,
								p.space_id AS spaceId
							FROM 
								core.page p, core.page_doc_map d
							WHERE 
								p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 1 ORDER BY d.version DESC LIMIT 1`
	getDocument = `SELECT 
							d.title AS title, 
							d.owner_id AS ownerId, 
							d.page_id id, 
							d.doc_id AS docId, 
							COALESCE(d.draft_generation, 0) AS draftGeneration,
							p.space_id AS spaceId
						FROM 
							core.page p, core.page_doc_map d
						WHERE 
							p.space_id = $1 AND p.id = $2 AND p.id = d.page_id AND d.draft = 0 ORDER BY d.version DESC LIMIT 1`
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
	deleteDocumentQuery = `DELETE FROM core.page WHERE id = $1 AND space_id = $2`

	// Whiteboard page creation (type-aware)
	newPageWithType = "INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id"

	// Whiteboard data
	insertWhiteboardData = `INSERT INTO core.whiteboard_data (doc_id, data, updated_at) VALUES ($1, $2, NOW()) RETURNING id`
	upsertWhiteboardData = `INSERT INTO core.whiteboard_data (doc_id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW() RETURNING id`
	
	publishWhiteboardFlipDraft = `
		UPDATE core.page_doc_map
		SET draft = 0, version = NOW()
		WHERE page_id = $1 AND draft = 1
		RETURNING doc_id`

	publishWhiteboardUpsertData = `
		INSERT INTO core.whiteboard_data (doc_id, data, preview_asset_name, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (doc_id) DO UPDATE
		SET data = EXCLUDED.data,
			preview_asset_name = EXCLUDED.preview_asset_name,
			updated_at = NOW()`

	insertDraftWhiteboardDocMap = `
		INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft)
		SELECT page_id, title, NOW(), $2, 1
		FROM core.page_doc_map
		WHERE page_id = $1
		ORDER BY version DESC
		LIMIT 1
		RETURNING doc_id`

	getWhiteboardVersions = `
		SELECT d.doc_id, d.version, COALESCE(wd.preview_asset_name, '') AS previewAssetName
		FROM core.page_doc_map d
		LEFT JOIN core.whiteboard_data wd ON d.doc_id = wd.doc_id
		WHERE d.page_id = $1 AND d.draft = 0
		ORDER BY d.version DESC`

	getWhiteboardDataByDocId = `
		SELECT
			COALESCE(wd.id, 0),
			d.doc_id,
			wd.data,
			d.title,
			d.page_id,
			p.space_id
		FROM core.page p
		JOIN core.page_doc_map d ON p.id = d.page_id
		LEFT JOIN core.whiteboard_data wd ON d.doc_id = wd.doc_id
		WHERE d.doc_id = $1 AND p.space_id = $2 AND d.draft = 0`

	getWhiteboardDraftData = `
		SELECT
			COALESCE(wd.id, 0),
			d.doc_id,
			wd.data,
			d.title,
			d.page_id,
			p.space_id
		FROM core.page p
		JOIN core.page_doc_map d ON p.id = d.page_id
		LEFT JOIN core.whiteboard_data wd ON d.doc_id = wd.doc_id
		WHERE d.page_id = $1 AND p.space_id = $2 AND d.draft = 1
		ORDER BY d.version DESC
		LIMIT 1`

	getWhiteboardPublishedData = `
		SELECT
			COALESCE(wd.id, 0),
			d.doc_id,
			wd.data,
			d.title,
			d.page_id,
			p.space_id,
			COALESCE(wd.preview_asset_name, '') AS previewAssetName
		FROM core.page p
		JOIN core.page_doc_map d ON p.id = d.page_id
		LEFT JOIN core.whiteboard_data wd ON d.doc_id = wd.doc_id
		WHERE d.page_id = $1 AND p.space_id = $2 AND d.draft = 0
		ORDER BY d.version DESC
		LIMIT 1`

	// Page metadata (type lookup)
	getPageMetadata           = `SELECT p.id, p.type, p.space_id AS spaceId FROM core.page p WHERE p.id = $1 AND p.space_id = $2`
	getPageInlineLinkMetadata = `SELECT
									p.id,
									CASE WHEN wd.doc_id IS NOT NULL THEN 'whiteboard' ELSE COALESCE(p.type, 'document') END AS type,
									p.space_id AS spaceId,
									COALESCE(d.title, 'Untitled') AS title,
									COALESCE(wd.preview_asset_name, '') AS previewAssetName
								FROM core.page p
								LEFT JOIN LATERAL (
									SELECT doc_id, title
									FROM core.page_doc_map
									WHERE page_id = p.id AND draft = 0
									ORDER BY version DESC LIMIT 1
								) d ON TRUE
								LEFT JOIN core.whiteboard_data wd ON d.doc_id = wd.doc_id
								WHERE p.id = $1 AND p.space_id = $2
								LIMIT 1`

	getViewSpaceSummary = `SELECT s.name, s.archived_at
FROM core.space s
WHERE s.id = $1`

	getViewDocumentMeta = `SELECT d.version AS published_at
FROM core.page_doc_map d
WHERE d.page_id = $1 AND d.draft = 0
ORDER BY d.version DESC
LIMIT 1`

	getEditMetaDraft = `SELECT d.doc_id, COALESCE(d.draft_generation, 0), d.version, d.title, p.parent_id
		FROM core.page p JOIN core.page_doc_map d ON p.id = d.page_id
		WHERE p.space_id = $1 AND p.id = $2 AND d.draft = 1
		ORDER BY d.version DESC LIMIT 1`

	getEditMetaPublished = `SELECT d.doc_id, COALESCE(d.draft_generation, 0), d.version, d.title, p.parent_id
		FROM core.page p JOIN core.page_doc_map d ON p.id = d.page_id
		WHERE p.space_id = $1 AND p.id = $2 AND d.draft = 0
		ORDER BY d.version DESC LIMIT 1`
)
