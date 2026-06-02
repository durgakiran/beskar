package space

const (
	GET_SPACE             = `SELECT id, name, description, date_created, date_updated, user_id, archived_at, archived_by, deleted_at, deleted_by FROM core.space WHERE id = $1 AND deleted_at IS NULL`
	GET_SPACE_SETTINGS    = `SELECT id, name, description, date_created, date_updated, user_id, archived_at, archived_by, deleted_at, deleted_by FROM core.space WHERE id = $1 AND deleted_at IS NULL`
	GET_SPACES            = `SELECT id, name, description, date_updated, user_id, archived_at FROM core.space WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY date_updated DESC;`
	INSERT_SPACE          = `INSERT INTO core.space (name, description, date_created, date_updated, user_id) VALUES ( $1, $2, $3, $4, $5) RETURNING id`
	UPDATE_SPACE          = `UPDATE core.space SET name = $1, description = $2, date_updated = $3 WHERE id = $4`
	ARCHIVE_SPACE         = `UPDATE core.space SET archived_at = now(), archived_by = $2, date_updated = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, name, description, date_created, date_updated, user_id, archived_at, archived_by, deleted_at, deleted_by`
	UNARCHIVE_SPACE       = `UPDATE core.space SET archived_at = NULL, archived_by = NULL, date_updated = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, name, description, date_created, date_updated, user_id, archived_at, archived_by, deleted_at, deleted_by`
	SOFT_DELETE_SPACE     = `UPDATE core.space SET deleted_at = now(), deleted_by = $2, date_updated = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`
	GET_SPACE_STATE       = `SELECT archived_at, deleted_at FROM core.space WHERE id = $1`
	GET_SPACE_PAGE_COUNTS = `SELECT 
								p.space_id,
								COUNT(*) FILTER (WHERE COALESCE(p.type, 'document') = 'document') AS doc_count,
								COUNT(*) FILTER (WHERE p.type = 'whiteboard') AS whiteboard_count
							FROM
								core.page p
							WHERE
								p.space_id = ANY($1)
							GROUP BY p.space_id`
	GET_PAGE_LIST_QUERY = `SELECT
								p.id,
								p.owner_id,
								p.parent_id,
								COALESCE(p.type, 'document') AS type,
								COALESCE(pr.title, d.title, 'Untitled') AS title,
								COALESCE(d.draft, 0) AS draft
							FROM
								core.page p
								LEFT JOIN LATERAL (
									SELECT title, draft
									FROM core.page_doc_map
									WHERE page_id = p.id
									ORDER BY version DESC
									LIMIT 1
								) d ON TRUE
								LEFT JOIN project.projects pr ON pr.page_id = p.id
							WHERE
								p.space_id = $1 AND p.id = ANY($2)
							ORDER BY p.id`
)
