package focus

const (
	getUserTasksQuery = `
		SELECT id, user_id, title, description, estimated_time, total_completed_time, 
		       status, priority, task_order, created_at, updated_at, deleted_at
		FROM focus.focus_tasks 
		WHERE user_id = $1 AND deleted_at IS NULL`

	getUserTasksCountQuery = `
		SELECT COUNT(*) 
		FROM focus.focus_tasks 
		WHERE user_id = $1 AND deleted_at IS NULL`

	getTaskByIDQuery = `
		SELECT id, user_id, title, description, estimated_time, total_completed_time, 
		       status, priority, task_order, created_at, updated_at, deleted_at
		FROM focus.focus_tasks 
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`

	createTaskQuery = `
		INSERT INTO focus.focus_tasks (id, user_id, title, description, estimated_time, 
		                              total_completed_time, status, priority, task_order, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`

	updateTaskBaseQuery = `UPDATE focus.focus_tasks SET updated_at = $1`

	deleteTaskQuery = `
		UPDATE focus.focus_tasks 
		SET deleted_at = $1, updated_at = $1 
		WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`

	// Get the next task order for a user
	getNextTaskOrderQuery = `
		SELECT COALESCE(MAX(task_order), -1) + 1
		FROM focus.focus_tasks 
		WHERE user_id = $1 AND deleted_at IS NULL`

	// Update task order for a specific task
	updateTaskOrderQuery = `
		UPDATE focus.focus_tasks 
		SET task_order = $1, updated_at = $2 
		WHERE id = $3 AND user_id = $4 AND deleted_at IS NULL`

	// Batch update task orders using VALUES clause
	batchReorderTasksQuery = `
		UPDATE focus.focus_tasks 
		SET task_order = v.task_order, updated_at = $%d
		FROM (VALUES %s) AS v(id, task_order)
		WHERE focus.focus_tasks.id = v.id::uuid 
		AND focus.focus_tasks.user_id = $%d
		AND focus.focus_tasks.deleted_at IS NULL`

	getUserSessionsQuery = `
		SELECT id, user_id, session_type, duration, actual_duration, 
		       started_at, ended_at, status, notes
		FROM focus.focus_sessions 
		WHERE user_id = $1`

	getUserSessionsCountQuery = `
		SELECT COUNT(*) 
		FROM focus.focus_sessions 
		WHERE user_id = $1`

	createSessionQuery = `
		INSERT INTO focus.focus_sessions (id, user_id, session_type, duration, 
		                                 actual_duration, started_at, ended_at, status, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	endSessionQuery = `
		UPDATE focus.focus_sessions 
		SET actual_duration = $1, ended_at = $2, status = $3 
		WHERE id = $4 AND user_id = $5`
)
