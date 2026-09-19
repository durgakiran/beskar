package page

import "github.com/durgakiran/beskar/core"

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
							SELECT
								p.id,
								p.parent_id,
								CASE WHEN wb.page_id IS NOT NULL THEN
 CASE WHEN p.id=ANY($2::bigint[]) THEN COALESCE(wbt.title,wbs.title,'Untitled') ELSE COALESCE(wbp.title,'Untitled') END
 ELSE COALESCE(pr.title, d.title, draft_doc.title, 'Untitled') END AS title
							FROM 
								pages p
								LEFT JOIN LATERAL (
									SELECT title
									FROM core.page_doc_map
									WHERE page_id = p.id AND draft = 0
									ORDER BY version DESC
									LIMIT 1
								) d ON TRUE
								LEFT JOIN LATERAL (
									SELECT title
									FROM core.page_doc_map
									WHERE page_id = p.id AND draft = 1
									ORDER BY version DESC
									LIMIT 1
								) draft_doc ON TRUE
								LEFT JOIN project.projects pr ON pr.page_id = p.id
` + core.WhiteboardTitleJoins + `
							ORDER BY p.id`
)
