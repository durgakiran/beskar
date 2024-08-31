package space

const (
	GET_SPACE           = `SELECT * FROM core.space WHERE id = $1`
	GET_SPACES          = `SELECT * FROM core.space WHERE id = ANY($1);`
	INSERT_SPACE        = `INSERT INTO core.space (name, date_created, date_updated, user_id) VALUES ( $1, $2, $3, $4) RETURNING id`
	UPDATE_SPACE        = `UPDATE core.space SET name = $1, date_updated = $2 WHERE id = $3`
	DELETE_SPACE        = `DELETE FROM core.space WHERE id = $3 RETURNING id`
	GET_PAGE_LIST_QUERY = `SELECT 
								DISTINCT ON (p.id)
								p.id,
								p.owner_id, 
								p.parent_id, 
								d.title, 
								d.draft 
							FROM 
								core.page p  LEFT JOIN core.page_doc_map d ON ( p.id = d.page_id ) 
							WHERE 
								p.space_id = $1 and p.id = ANY($2)
							ORDER BY p.id, d.version DESC`
)
