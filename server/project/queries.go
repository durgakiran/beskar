package project

const (
	ticketSummarySelect = `t.id,
		t.project_id,
		t.sequence_no,
		t.identifier,
		t.type,
		t.parent_ticket_id,
		t.root_ticket_id,
		t.depth,
		t.title,
		t.description,
		t.status,
		t.priority,
		t.assignee_user_id,
		t.assignee_name,
		t.reporter_user_id,
		t.reporter_name,
		t.label_names,
		t.due_at,
		t.rank,
		t.created_at,
		t.updated_at,
		pt.identifier AS parent_identifier,
		pt.title AS parent_title,
		COALESCE(tc.child_count, 0) AS child_count,
		COALESCE(tc.open_child_count, 0) AS open_child_count,
		COALESCE(tc.done_child_count, 0) AS done_child_count`

	ticketSummaryFrom = `FROM project.tickets t
	LEFT JOIN project.tickets pt ON pt.id = t.parent_ticket_id
	LEFT JOIN LATERAL (
		SELECT
			COUNT(*) AS child_count,
			COUNT(*) FILTER (WHERE child.archived_at IS NULL AND child.status NOT IN ('done', 'canceled')) AS open_child_count,
			COUNT(*) FILTER (WHERE child.archived_at IS NULL AND child.status = 'done') AS done_child_count
		FROM project.tickets child
		WHERE child.parent_ticket_id = t.id AND child.archived_at IS NULL
	) tc ON TRUE`

	insertProjectPage = `INSERT INTO core.page (space_id, owner_id, parent_id, date_created, status, type)
		VALUES ($1, $2, $3, NOW(), 0, 'project')
		RETURNING id`

	insertProject = `INSERT INTO project.projects
		(page_id, space_id, key, title, description, default_view, created_by, updated_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, NOW(), NOW())
		RETURNING id`

	getProjectKeyConflicts = `SELECT key
		FROM project.projects
		WHERE space_id = $1 AND key LIKE $2
		ORDER BY key`

	getProjectView = `SELECT
			pr.id,
			pr.page_id,
			pr.space_id,
			pr.key,
			pr.title,
			pr.description,
			pr.default_view,
			pr.created_by,
			pr.updated_by,
			pr.created_at,
			pr.updated_at,
			pr.archived_at,
			s.name,
			s.archived_at AS space_archived_at,
			COALESCE(ts.ticket_count, 0) AS ticket_count,
			COALESCE(ts.open_count, 0) AS open_count,
			COALESCE(ts.done_count, 0) AS done_count
		FROM project.projects pr
		JOIN core.space s ON s.id = pr.space_id
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) AS ticket_count,
				COUNT(*) FILTER (WHERE archived_at IS NULL AND status NOT IN ('done', 'canceled')) AS open_count,
				COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'done') AS done_count
			FROM project.tickets
			WHERE project_id = pr.id
		) ts ON TRUE
		WHERE pr.page_id = $1 AND pr.space_id = $2`

	getProjectIdentityForCreate = `SELECT id, key, title
		FROM project.projects
		WHERE page_id = $1 AND space_id = $2`

	getParentTicketForCreate = `SELECT
			id,
			project_id,
			identifier,
			title,
			type,
			parent_ticket_id,
			root_ticket_id,
			depth
		FROM project.tickets
		WHERE id = $1 AND project_id = $2 AND archived_at IS NULL`

	lockProjectForTicketSequence = `SELECT key
		FROM project.projects
		WHERE id = $1
		FOR UPDATE`

	getNextTicketSequence = `SELECT COALESCE(MAX(sequence_no), 0) + 1
		FROM project.tickets
		WHERE project_id = $1`

	insertTicket = `INSERT INTO project.tickets
		(project_id, sequence_no, identifier, type, parent_ticket_id, root_ticket_id, depth, title, description, status, priority, assignee_user_id, assignee_name, reporter_user_id, reporter_name, label_names, due_at, rank, created_by, updated_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $14, $14, NOW(), NOW())
		RETURNING id, project_id, sequence_no, identifier, type, parent_ticket_id, root_ticket_id, depth, title, description, status, priority, assignee_user_id, assignee_name, reporter_user_id, reporter_name, label_names, due_at, rank, created_at, updated_at`

	getProjectTicket = `SELECT
		` + ticketSummarySelect + `
		` + ticketSummaryFrom + `
		WHERE t.id = $1 AND t.project_id = $2 AND t.archived_at IS NULL`

	updateTicket = `UPDATE project.tickets
		SET
			title = CASE WHEN $3 THEN $4 ELSE title END,
			description = CASE WHEN $5 THEN $6 ELSE description END,
			type = CASE WHEN $7 THEN $8 ELSE type END,
			status = CASE WHEN $9 THEN $10 ELSE status END,
			priority = CASE WHEN $11 THEN $12 ELSE priority END,
			parent_ticket_id = CASE WHEN $13 THEN $14::uuid ELSE parent_ticket_id END,
			root_ticket_id = CASE WHEN $13 THEN $15::uuid ELSE root_ticket_id END,
			depth = CASE WHEN $13 THEN $16 ELSE depth END,
			label_names = CASE WHEN $17 THEN $18 ELSE label_names END,
			assignee_user_id = CASE WHEN $19 THEN $20::uuid ELSE assignee_user_id END,
			assignee_name = CASE
				WHEN $19 AND $20::uuid IS NULL THEN NULL
				WHEN $19 THEN $21
				ELSE assignee_name
			END,
			due_at = CASE WHEN $22 THEN $23 ELSE due_at END,
			updated_by = $2,
			updated_at = NOW(),
			started_at = CASE
				WHEN $9 AND $10 = 'in_progress' AND started_at IS NULL THEN NOW()
				ELSE started_at
			END,
			completed_at = CASE
				WHEN $9 AND $10 = 'done' THEN COALESCE(completed_at, NOW())
				WHEN $9 AND $10 <> 'done' THEN NULL
				ELSE completed_at
			END
		WHERE id = $1 AND project_id = $24 AND archived_at IS NULL`

	deleteDescriptionTicketLinks = `DELETE FROM project.ticket_links
		WHERE ticket_id = $1 AND source = 'description'`

	insertDescriptionTicketLink = `INSERT INTO project.ticket_links
		(ticket_id, url, title, source, created_by, created_at)
		VALUES ($1, $2, $3, 'description', $4, NOW())`

	listTicketLinks = `SELECT id, ticket_id, url, title, source, created_at
		FROM project.ticket_links
		WHERE ticket_id = $1
		ORDER BY created_at ASC, id ASC`

	listTicketAttachments = `SELECT
			a.id::text,
			a.file_name,
			a.file_size,
			a.mime_type,
			'/api/v1/attachments/' || a.id::text AS url,
			ta.attached_at
		FROM project.ticket_attachments ta
		JOIN core.attachment a ON a.id = ta.attachment_id
		WHERE ta.ticket_id = $1 AND a.deleted_at IS NULL
		ORDER BY ta.attached_at DESC, a.id DESC`

	resolvePageAttachmentForTicket = `SELECT a.id::text
		FROM core.attachment a
		WHERE a.id = $1::uuid AND a.page_id = $2 AND a.deleted_at IS NULL`

	insertTicketAttachment = `INSERT INTO project.ticket_attachments
		(ticket_id, attachment_id, attached_by, attached_at)
		VALUES ($1, $2::uuid, $3, NOW())
		ON CONFLICT (ticket_id, attachment_id) DO NOTHING`

	deleteTicketAttachment = `DELETE FROM project.ticket_attachments
		WHERE ticket_id = $1 AND attachment_id = $2::uuid`

	listTicketComments = `SELECT
			id,
			ticket_id,
			body,
			created_by,
			created_by_name,
			updated_by,
			created_at,
			updated_at
		FROM project.ticket_comments
		WHERE ticket_id = $1
		ORDER BY created_at ASC, id ASC`

	listTicketActivity = `SELECT
			id,
			ticket_id,
			project_id,
			activity_type,
			field_name,
			old_value,
			new_value,
			actor_id,
			actor_name,
			created_at
		FROM project.ticket_activity
		WHERE ticket_id = $1
		ORDER BY created_at DESC, id DESC`

	listProjectActivity = `SELECT
			id,
			ticket_id,
			project_id,
			activity_type,
			field_name,
			old_value,
			new_value,
			actor_id,
			actor_name,
			created_at
		FROM project.ticket_activity
		WHERE project_id = $1
			AND ($2::timestamptz IS NULL OR created_at > $2)
		ORDER BY created_at DESC, id DESC
		LIMIT $3`

	insertTicketComment = `INSERT INTO project.ticket_comments
		(ticket_id, body, created_by, created_by_name, updated_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $3, NOW(), NOW())
		RETURNING id, ticket_id, body, created_by, created_by_name, updated_by, created_at, updated_at`

	insertTicketActivity = `INSERT INTO project.ticket_activity
		(ticket_id, project_id, activity_type, field_name, old_value, new_value, actor_id, actor_name, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())
		RETURNING id, ticket_id, project_id, activity_type, field_name, old_value, new_value, actor_id, actor_name, created_at`

	listChildTickets = `SELECT
		` + ticketSummarySelect + `
		` + ticketSummaryFrom + `
		WHERE t.parent_ticket_id = $1 AND t.archived_at IS NULL
		ORDER BY t.sequence_no ASC`
)
