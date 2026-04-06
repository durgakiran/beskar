package space

const (
	GET_SPACE             = `SELECT id, name, description, date_created, date_updated, user_id FROM core.space WHERE id = $1`
	GET_SPACES            = `SELECT id, name, description, date_updated, user_id FROM core.space WHERE id = ANY($1) ORDER BY date_updated DESC;`
	INSERT_SPACE          = `INSERT INTO core.space (name, description, date_created, date_updated, user_id) VALUES ( $1, $2, $3, $4, $5) RETURNING id`
	UPDATE_SPACE          = `UPDATE core.space SET name = $1, description = $2, date_updated = $3 WHERE id = $4`
	DELETE_SPACE          = `DELETE FROM core.space WHERE id = $3 RETURNING id`
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
								DISTINCT ON (p.id)
								p.id,
								p.owner_id, 
								p.parent_id, 
								COALESCE(p.type, 'document') as type,
								d.title, 
								d.draft 
							FROM 
								core.page p  LEFT JOIN core.page_doc_map d ON ( p.id = d.page_id ) 
							WHERE 
								p.space_id = $1 and p.id = ANY($2)
							ORDER BY p.id, d.version DESC`
)
