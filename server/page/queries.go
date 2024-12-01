package page

const (
	GET_PAGE_BREAD_CRUMBS = `WITH recursive pages AS (
								SELECT 
									p.id, p.parent_id
								FROM
									core.page p
								WHERE
									id = $1

								UNION

								SELECT 
									p.id, p.parent_id
								FROM
									core.page p INNER JOIN pages p1 ON (p.id = p1.parent_id)
							)
							SELECT DISTINCT ON (p.id) 
								p.id, p.parent_id, d.title 
							FROM 
								pages p LEFT JOIN 
								core.page_doc_map d ON (p.id = d.page_id)
							WHERE d.draft = 0
							ORDER BY p.id, d.version desc`
)
