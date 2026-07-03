package project

const (
	insertCycleTrack = `INSERT INTO project.cycle_tracks
		(project_id, key, name, position, display_style, activation_policy, max_assignments_per_ticket, color_token, created_by, updated_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW(), NOW())
		ON CONFLICT (project_id, key) DO NOTHING`

	listCycleTracks = `SELECT
			id,
			project_id,
			key,
			name,
			position,
			display_style,
			activation_policy,
			max_assignments_per_ticket,
			color_token
		FROM project.cycle_tracks
		WHERE project_id = $1 AND archived_at IS NULL
		ORDER BY position ASC, created_at ASC, name ASC`

	getCycleTrackByID = `SELECT
			id,
			project_id,
			key,
			name,
			position,
			display_style,
			activation_policy,
			max_assignments_per_ticket,
			color_token
		FROM project.cycle_tracks
		WHERE id = $1 AND project_id = $2 AND archived_at IS NULL`

	insertCycle = `INSERT INTO project.cycles
		(project_id, track_id, name, goal, description, state, starts_at, ends_at, position, completed_at, created_by, updated_by, created_at, updated_at)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			COALESCE((SELECT COALESCE(MAX(position), 0) + 1 FROM project.cycles WHERE project_id = $1 AND track_id = $2 AND archived_at IS NULL), 1),
			CASE WHEN $6 = 'completed' THEN NOW() ELSE NULL END,
			$9, $9, NOW(), NOW()
		)
		RETURNING id`

	listCycles = `SELECT
			c.id,
			c.project_id,
			c.track_id,
			c.name,
			c.goal,
			c.description,
			c.state,
			c.starts_at,
			c.ends_at,
			c.position,
			c.completed_at,
			ct.id,
			ct.key,
			ct.name,
			ct.position,
			ct.display_style,
			ct.activation_policy,
			COALESCE(cs.ticket_count, 0),
			COALESCE(cs.open_count, 0),
			COALESCE(cs.done_count, 0)
		FROM project.cycles c
		JOIN project.cycle_tracks ct ON ct.id = c.track_id AND ct.archived_at IS NULL
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) AS ticket_count,
				COUNT(*) FILTER (WHERE t.archived_at IS NULL AND t.status NOT IN ('done', 'canceled')) AS open_count,
				COUNT(*) FILTER (WHERE t.archived_at IS NULL AND t.status = 'done') AS done_count
			FROM project.ticket_cycle_assignments tca
			JOIN project.tickets t ON t.id = tca.ticket_id
			WHERE tca.cycle_id = c.id AND t.archived_at IS NULL
		) cs ON TRUE
		WHERE c.project_id = $1
			AND c.archived_at IS NULL
			AND ($2::uuid IS NULL OR c.track_id = $2)
			AND ($3::text IS NULL OR c.state = $3)
		ORDER BY ct.position ASC, c.position ASC, COALESCE(c.starts_at, c.ends_at) ASC, c.name ASC`

	getCycleByID = `SELECT
			c.id,
			c.project_id,
			c.track_id,
			c.name,
			c.goal,
			c.description,
			c.state,
			c.starts_at,
			c.ends_at,
			c.position,
			c.completed_at,
			ct.id,
			ct.key,
			ct.name,
			ct.position,
			ct.display_style,
			ct.activation_policy,
			COALESCE(cs.ticket_count, 0),
			COALESCE(cs.open_count, 0),
			COALESCE(cs.done_count, 0)
		FROM project.cycles c
		JOIN project.cycle_tracks ct ON ct.id = c.track_id AND ct.archived_at IS NULL
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) AS ticket_count,
				COUNT(*) FILTER (WHERE t.archived_at IS NULL AND t.status NOT IN ('done', 'canceled')) AS open_count,
				COUNT(*) FILTER (WHERE t.archived_at IS NULL AND t.status = 'done') AS done_count
			FROM project.ticket_cycle_assignments tca
			JOIN project.tickets t ON t.id = tca.ticket_id
			WHERE tca.cycle_id = c.id AND t.archived_at IS NULL
		) cs ON TRUE
		WHERE c.id = $1 AND c.project_id = $2 AND c.archived_at IS NULL`

	updateCycle = `UPDATE project.cycles
		SET
			name = CASE WHEN $3 THEN $4 ELSE name END,
			goal = CASE WHEN $5 THEN $6 ELSE goal END,
			description = CASE WHEN $7 THEN $8 ELSE description END,
			state = CASE WHEN $9 THEN $10 ELSE state END,
			starts_at = CASE WHEN $11 THEN $12 ELSE starts_at END,
			ends_at = CASE WHEN $13 THEN $14 ELSE ends_at END,
			position = CASE WHEN $15 THEN $16 ELSE position END,
			completed_at = CASE
				WHEN $9 AND $10 = 'completed' THEN COALESCE(completed_at, NOW())
				WHEN $9 AND $10 <> 'completed' THEN NULL
				ELSE completed_at
			END,
			updated_by = $2,
			updated_at = NOW()
		WHERE id = $1 AND project_id = $17 AND archived_at IS NULL`

	listUnplannedTicketCountsByTrack = `SELECT
			ct.id,
			COUNT(t.id) FILTER (
				WHERE t.archived_at IS NULL
					AND NOT EXISTS (
						SELECT 1
						FROM project.ticket_cycle_assignments tca
						WHERE tca.ticket_id = t.id
							AND tca.track_id = ct.id
					)
			) AS unplanned_count
		FROM project.cycle_tracks ct
		LEFT JOIN project.tickets t ON t.project_id = ct.project_id
		WHERE ct.project_id = $1 AND ct.archived_at IS NULL
		GROUP BY ct.id`

	listTicketCycleAssignments = `SELECT
			tca.ticket_id,
			ct.id,
			ct.key,
			ct.name,
			ct.position,
			ct.display_style,
			ct.activation_policy,
			c.id,
			c.project_id,
			c.track_id,
			c.name,
			c.goal,
			c.description,
			c.state,
			c.starts_at,
			c.ends_at,
			c.position,
			c.completed_at
		FROM project.ticket_cycle_assignments tca
		JOIN project.cycle_tracks ct ON ct.id = tca.track_id AND ct.archived_at IS NULL
		JOIN project.cycles c ON c.id = tca.cycle_id AND c.archived_at IS NULL
		WHERE tca.project_id = $1 AND tca.ticket_id = ANY($2)
		ORDER BY ct.position ASC, c.position ASC, COALESCE(c.starts_at, c.ends_at) ASC, c.name ASC`

	listCycleAssignmentsForCycleValidation = `SELECT
			c.id,
			c.project_id,
			c.track_id,
			c.name,
			c.goal,
			c.description,
			c.state,
			c.starts_at,
			c.ends_at,
			c.position,
			c.completed_at,
			ct.id,
			ct.key,
			ct.name,
			ct.position,
			ct.display_style,
			ct.activation_policy,
			ct.max_assignments_per_ticket,
			ct.color_token
		FROM project.cycles c
		JOIN project.cycle_tracks ct ON ct.id = c.track_id AND ct.archived_at IS NULL
		WHERE c.project_id = $1
			AND c.id = ANY($2)
			AND c.archived_at IS NULL`

	deleteTicketCycleAssignments = `DELETE FROM project.ticket_cycle_assignments
		WHERE ticket_id = $1`

	insertTicketCycleAssignment = `INSERT INTO project.ticket_cycle_assignments
		(project_id, ticket_id, track_id, cycle_id, created_by, updated_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5, NOW(), NOW())
		ON CONFLICT (ticket_id, track_id)
		DO UPDATE SET
			cycle_id = EXCLUDED.cycle_id,
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW()`

	countActiveCyclesForTrack = `SELECT COUNT(*)
		FROM project.cycles
		WHERE project_id = $1
			AND track_id = $2
			AND state = 'active'
			AND archived_at IS NULL
			AND ($3::uuid IS NULL OR id <> $3::uuid)`
)
