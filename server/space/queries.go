package space

import "github.com/durgakiran/beskar/core"

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
								COALESCE(p.parent_id,0) AS parent_id,
								CASE WHEN wb.page_id IS NOT NULL OR wd.doc_id IS NOT NULL THEN 'whiteboard' ELSE COALESCE(p.type, 'document') END AS type,
								CASE WHEN wb.page_id IS NOT NULL THEN
 CASE WHEN p.id=ANY($3::bigint[]) THEN COALESCE(wbt.title,wbs.title,'Untitled') ELSE COALESCE(wbp.title,'Untitled') END
 ELSE COALESCE(pr.title, d.title, 'Untitled') END AS title,
								CASE WHEN wb.page_id IS NOT NULL THEN CASE WHEN p.id=ANY($3::bigint[]) AND (wb.published_version_id IS NULL OR wbd.head_sequence > wbp.through_sequence) THEN 1 ELSE 0 END ELSE COALESCE(d.draft, 0) END AS draft,
 CASE WHEN wb.page_id IS NOT NULL THEN 2 ELSE 1 END AS content_api_version,
 wb.published_version_id,
 COALESCE(p.id=ANY($3::bigint[]),false) AS can_edit,
 EXISTS(SELECT 1 FROM whiteboard.whiteboard_version_preview WHERE version_id=wb.published_version_id) AS has_preview
							FROM
								core.page p
								LEFT JOIN LATERAL (
									SELECT doc_id, title, draft
									FROM core.page_doc_map
									WHERE page_id = p.id
									ORDER BY version DESC
									LIMIT 1
								) d ON TRUE
								LEFT JOIN project.projects pr ON pr.page_id = p.id
								LEFT JOIN core.whiteboard_data wd ON wd.doc_id = d.doc_id
` + core.WhiteboardTitleJoins + `
							WHERE
								p.space_id = $1 AND p.id = ANY($2)
 AND EXISTS(SELECT 1 FROM core.space s WHERE s.id=p.space_id AND s.deleted_at IS NULL)
 AND (wb.page_id IS NULL OR p.id=ANY($3::bigint[]) OR wb.published_version_id IS NOT NULL)
							ORDER BY p.sort_key, p.id`
	GET_PAGE_CHANGE_SPACE = `SELECT archived_at IS NULL AND deleted_at IS NULL
		FROM core.space WHERE id = $1`
	SET_PAGE_CHANGE_LOCK_TIMEOUT = `SET LOCAL lock_timeout = '1s'`
	GET_PAGE_ORDER_STATE         = `SELECT GREATEST(COALESCE(parent_id, 0), 0), sort_key
		FROM core.page WHERE id = $1 AND space_id = $2`
	GET_PAGE_MOVE_DESTINATION = `WITH RECURSIVE ancestors AS (
			SELECT id, parent_id FROM core.page WHERE id = $1 AND space_id = $2
			UNION
			SELECT p.id, p.parent_id
			FROM core.page p
			JOIN ancestors a ON p.id = a.parent_id
			WHERE p.space_id = $2
		)
		SELECT
			EXISTS (SELECT 1 FROM ancestors),
			EXISTS (SELECT 1 FROM ancestors WHERE id = $3)`
	GET_PAGE_LAST_SORT_KEY = `SELECT sort_key FROM core.page
		WHERE space_id = $1 AND GREATEST(COALESCE(parent_id, 0), 0) = $2 AND id <> $3
		ORDER BY sort_key DESC LIMIT 1`
	GET_PAGE_PREVIOUS_SORT_KEY = `SELECT sort_key FROM core.page
		WHERE space_id = $1 AND GREATEST(COALESCE(parent_id, 0), 0) = $2
			AND id <> $3 AND sort_key < $4 COLLATE "C"
		ORDER BY sort_key DESC LIMIT 1`
	GET_PAGE_NEXT_SORT_KEY = `SELECT sort_key FROM core.page
		WHERE space_id = $1 AND GREATEST(COALESCE(parent_id, 0), 0) = $2
			AND id <> $3 AND sort_key > $4 COLLATE "C"
		ORDER BY sort_key LIMIT 1`
	UPDATE_PAGE_ORDER  = `UPDATE core.page SET sort_key = $3 WHERE id = $1 AND space_id = $2`
	UPDATE_PAGE_PARENT = `UPDATE core.page SET parent_id = $3, sort_key = $4 WHERE id = $1 AND space_id = $2`
)
