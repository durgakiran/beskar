package focus

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetUserTasks retrieves tasks for a user with optional filtering
func GetUserTasks(userId uuid.UUID, filters *TaskFilters) ([]Task, int, error) {
	conn := core.GetPool()
	ctx := context.Background()

	baseQuery := getUserTasksQuery
	countQuery := getUserTasksCountQuery

	// Add filters to queries
	args := []interface{}{userId}
	argIndex := 2

	if filters.Status != "" {
		baseQuery += fmt.Sprintf(" AND status = $%d", argIndex)
		countQuery += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, filters.Status)
		argIndex++
	}

	if filters.Priority != "" {
		baseQuery += fmt.Sprintf(" AND priority = $%d", argIndex)
		countQuery += fmt.Sprintf(" AND priority = $%d", argIndex)
		args = append(args, filters.Priority)
		argIndex++
	}

	// Add ordering and pagination
	baseQuery += " ORDER BY task_order ASC"
	baseQuery += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, filters.Limit, filters.Offset)

	// Get total count
	var total int
	err := conn.QueryRow(ctx, countQuery, args[:argIndex-1]...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get task count: %w", err)
	}

	// Get tasks
	rows, err := conn.Query(ctx, baseQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var task Task
		err := rows.Scan(
			&task.ID,
			&task.UserID,
			&task.Title,
			&task.Description,
			&task.EstimatedTime,
			&task.TotalCompletedTime,
			&task.Status,
			&task.Priority,
			&task.TaskOrder,
			&task.CreatedAt,
			&task.UpdatedAt,
			&task.DeletedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan task: %w", err)
		}
		tasks = append(tasks, task)
	}

	if err = rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("error iterating tasks: %w", err)
	}

	return tasks, total, nil
}

// GetTaskByID retrieves a specific task by ID
func GetTaskByID(taskId, userId uuid.UUID) (*Task, error) {
	conn := core.GetPool()
	ctx := context.Background()

	query := getTaskByIDQuery

	var task Task
	err := conn.QueryRow(ctx, query, taskId, userId).Scan(
		&task.ID,
		&task.UserID,
		&task.Title,
		&task.Description,
		&task.EstimatedTime,
		&task.TotalCompletedTime,
		&task.Status,
		&task.Priority,
		&task.TaskOrder,
		&task.CreatedAt,
		&task.UpdatedAt,
		&task.DeletedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("task not found")
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	return &task, nil
}

// CreateTask creates a new task
func CreateTask(task *Task) error {
	conn := core.GetPool()
	ctx := context.Background()

	// Get the next task order for this user
	var nextOrder int
	err := conn.QueryRow(ctx, getNextTaskOrderQuery, task.UserID).Scan(&nextOrder)
	if err != nil {
		return fmt.Errorf("failed to get next task order: %w", err)
	}

	query := createTaskQuery

	now := time.Now()
	task.CreatedAt = now
	task.UpdatedAt = now
	task.TaskOrder = nextOrder

	_, err = conn.Exec(ctx, query,
		task.ID,
		task.UserID,
		task.Title,
		task.Description,
		task.EstimatedTime,
		task.TotalCompletedTime,
		task.Status,
		task.Priority,
		task.TaskOrder,
		task.CreatedAt,
		task.UpdatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create task: %w", err)
	}

	return nil
}

// UpdateTask updates an existing task
func UpdateTask(taskId, userId uuid.UUID, updates map[string]interface{}) (*Task, error) {
	conn := core.GetPool()
	ctx := context.Background()

	query := updateTaskBaseQuery
	args := []interface{}{time.Now()}
	argIndex := 2

	for field, value := range updates {
		query += fmt.Sprintf(", %s = $%d", field, argIndex)
		args = append(args, value)
		argIndex++
	}

	query += fmt.Sprintf(" WHERE id = $%d AND user_id = $%d AND deleted_at IS NULL", argIndex, argIndex+1)
	args = append(args, taskId, userId)

	result, err := conn.Exec(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to update task: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, fmt.Errorf("task not found or no changes made")
	}

	// Return the updated task
	return GetTaskByID(taskId, userId)
}

// DeleteTask soft deletes a task
func DeleteTask(taskId, userId uuid.UUID) error {
	conn := core.GetPool()
	ctx := context.Background()

	query := deleteTaskQuery

	result, err := conn.Exec(ctx, query, time.Now(), taskId, userId)
	if err != nil {
		return fmt.Errorf("failed to delete task: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("task not found")
	}

	return nil
}

// UpdateTaskStatus updates the status of a task
func UpdateTaskStatus(taskId, userId uuid.UUID, status string) (*Task, error) {
	updates := map[string]interface{}{
		"status": status,
	}
	return UpdateTask(taskId, userId, updates)
}

// UpdateTaskTime updates the completed time of a task
func UpdateTaskTime(taskId, userId uuid.UUID, completedTime int) (*Task, error) {
	updates := map[string]interface{}{
		"total_completed_time": completedTime,
	}
	return UpdateTask(taskId, userId, updates)
}

// ReorderTasks updates the order of multiple tasks
func ReorderTasks(userId uuid.UUID, taskOrders []TaskOrderItem) error {
	conn := core.GetPool()
	ctx := context.Background()

	if len(taskOrders) == 0 {
		return fmt.Errorf("no task orders provided")
	}

	// Start transaction
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Build VALUES clause with explicit type casting
	var valueClauses []string
	var args []interface{}
	argIndex := 1

	for _, item := range taskOrders {
		// Use explicit type casting in the VALUES clause
		valueClauses = append(valueClauses, fmt.Sprintf("($%d::uuid, $%d::integer)", argIndex, argIndex+1))
		args = append(args, item.TaskID, item.TaskOrder)
		argIndex += 2
	}

	query := fmt.Sprintf(batchReorderTasksQuery, argIndex, strings.Join(valueClauses, ", "), argIndex+1)

	args = append(args, time.Now(), userId)

	result, err := tx.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to reorder tasks: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("no tasks were updated")
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetUserSessions retrieves sessions for a user with optional filtering
func GetUserSessions(userId uuid.UUID, filters *SessionFilters) ([]Session, int, error) {
	conn := core.GetPool()
	ctx := context.Background()

	baseQuery := getUserSessionsQuery
	countQuery := getUserSessionsCountQuery

	// Add filters to queries
	args := []interface{}{userId}
	argIndex := 2

	if filters.Status != "" {
		baseQuery += fmt.Sprintf(" AND status = $%d", argIndex)
		countQuery += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, filters.Status)
		argIndex++
	}

	if filters.SessionType != "" {
		baseQuery += fmt.Sprintf(" AND session_type = $%d", argIndex)
		countQuery += fmt.Sprintf(" AND session_type = $%d", argIndex)
		args = append(args, filters.SessionType)
		argIndex++
	}

	// Add ordering and pagination
	baseQuery += " ORDER BY started_at DESC"
	baseQuery += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, filters.Limit, filters.Offset)

	// Get total count
	var total int
	err := conn.QueryRow(ctx, countQuery, args[:argIndex-1]...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get session count: %w", err)
	}

	// Get sessions
	rows, err := conn.Query(ctx, baseQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var session Session
		err := rows.Scan(
			&session.ID,
			&session.UserID,
			&session.SessionType,
			&session.Duration,
			&session.ActualDuration,
			&session.StartedAt,
			&session.EndedAt,
			&session.Status,
			&session.Notes,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan session: %w", err)
		}
		sessions = append(sessions, session)
	}

	if err = rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("error iterating sessions: %w", err)
	}

	return sessions, total, nil
}

// CreateSession creates a new session
func CreateSession(session *Session) error {
	conn := core.GetPool()
	ctx := context.Background()

	query := createSessionQuery

	now := time.Now()
	session.StartedAt = now

	_, err := conn.Exec(ctx, query,
		session.ID,
		session.UserID,
		session.SessionType,
		session.Duration,
		session.ActualDuration,
		session.StartedAt,
		session.EndedAt,
		session.Status,
		session.Notes,
	)

	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	return nil
}

// EndSession ends a session
func EndSession(sessionId, userId uuid.UUID, actualDuration int, status string) error {
	conn := core.GetPool()
	ctx := context.Background()

	query := endSessionQuery

	result, err := conn.Exec(ctx, query, actualDuration, time.Now(), status, sessionId, userId)
	if err != nil {
		return fmt.Errorf("failed to end session: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("session not found")
	}

	return nil
}

// GetSessionByID retrieves a specific session by ID
func GetSessionByID(sessionId, userId uuid.UUID) (*Session, error) {
	conn := core.GetPool()
	ctx := context.Background()

	query := `
		SELECT id, user_id, session_type, duration, actual_duration, 
		       started_at, ended_at, status, notes
		FROM focus.focus_sessions 
		WHERE id = $1 AND user_id = $2`

	var session Session
	err := conn.QueryRow(ctx, query, sessionId, userId).Scan(
		&session.ID,
		&session.UserID,
		&session.SessionType,
		&session.Duration,
		&session.ActualDuration,
		&session.StartedAt,
		&session.EndedAt,
		&session.Status,
		&session.Notes,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("session not found")
		}
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	return &session, nil
}

// Session-Task Relationship Functions

const (
	getSessionTasksQuery = `
		SELECT st.id, st.session_id, st.task_id, st.time_spent, 
		       st.started_at, st.ended_at, st.status, st.notes,
		       t.title, t.description, t.priority
		FROM focus.focus_session_tasks st
		JOIN focus.focus_tasks t ON st.task_id = t.id
		WHERE st.session_id = $1 AND t.user_id = $2
		ORDER BY st.started_at ASC`

	getSessionTaskByIDQuery = `
		SELECT st.id, st.session_id, st.task_id, st.time_spent, 
		       st.started_at, st.ended_at, st.status, st.notes,
		       t.title, t.description, t.priority
		FROM focus.focus_session_tasks st
		JOIN focus.focus_tasks t ON st.task_id = t.id
		WHERE st.id = $1 AND t.user_id = $2`

	createSessionTaskQuery = `
		INSERT INTO focus.focus_session_tasks (id, session_id, task_id, time_spent, 
		                                      started_at, ended_at, status, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

	updateSessionTaskQuery = `
		UPDATE focus.focus_session_tasks 
		SET time_spent = $1, ended_at = $2, status = $3, notes = $4
		WHERE id = $5 AND session_id = $6`

	deleteSessionTaskQuery = `
		DELETE FROM focus.focus_session_tasks 
		WHERE id = $1 AND session_id = $2`
)

// GetSessionTasks retrieves all tasks for a specific session
func GetSessionTasks(sessionId, userId uuid.UUID) ([]SessionTask, error) {
	conn := core.GetPool()
	ctx := context.Background()

	rows, err := conn.Query(ctx, getSessionTasksQuery, sessionId, userId)
	if err != nil {
		return nil, fmt.Errorf("failed to get session tasks: %w", err)
	}
	defer rows.Close()

	var sessionTasks []SessionTask
	for rows.Next() {
		var st SessionTask
		var taskTitle, taskDescription, taskPriority string

		err := rows.Scan(
			&st.ID,
			&st.SessionID,
			&st.TaskID,
			&st.TimeSpent,
			&st.StartedAt,
			&st.EndedAt,
			&st.Status,
			&st.Notes,
			&taskTitle,
			&taskDescription,
			&taskPriority,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session task: %w", err)
		}

		// Add task details to the session task
		st.TaskTitle = taskTitle
		st.TaskDescription = taskDescription
		st.TaskPriority = taskPriority

		sessionTasks = append(sessionTasks, st)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating session tasks: %w", err)
	}

	return sessionTasks, nil
}

// GetSessionTaskByID retrieves a specific session task by ID
func GetSessionTaskByID(sessionTaskId, userId uuid.UUID) (*SessionTask, error) {
	conn := core.GetPool()
	ctx := context.Background()

	var st SessionTask
	var taskTitle, taskDescription, taskPriority string

	err := conn.QueryRow(ctx, getSessionTaskByIDQuery, sessionTaskId, userId).Scan(
		&st.ID,
		&st.SessionID,
		&st.TaskID,
		&st.TimeSpent,
		&st.StartedAt,
		&st.EndedAt,
		&st.Status,
		&st.Notes,
		&taskTitle,
		&taskDescription,
		&taskPriority,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("session task not found")
		}
		return nil, fmt.Errorf("failed to get session task: %w", err)
	}

	// Add task details to the session task
	st.TaskTitle = taskTitle
	st.TaskDescription = taskDescription
	st.TaskPriority = taskPriority

	return &st, nil
}

// CreateSessionTask creates a new session task relationship
func CreateSessionTask(sessionTask *SessionTask) error {
	conn := core.GetPool()
	ctx := context.Background()

	now := time.Now()
	sessionTask.StartedAt = now

	_, err := conn.Exec(ctx, createSessionTaskQuery,
		sessionTask.ID,
		sessionTask.SessionID,
		sessionTask.TaskID,
		sessionTask.TimeSpent,
		sessionTask.StartedAt,
		sessionTask.EndedAt,
		sessionTask.Status,
		sessionTask.Notes,
	)

	if err != nil {
		return fmt.Errorf("failed to create session task: %w", err)
	}

	return nil
}

// UpdateSessionTask updates an existing session task
func UpdateSessionTask(sessionTaskId, sessionId, userId uuid.UUID, timeSpent int, status string, notes string) (*SessionTask, error) {
	conn := core.GetPool()
	ctx := context.Background()

	var endedAt *time.Time
	if status == "completed" {
		now := time.Now()
		endedAt = &now
	}

	result, err := conn.Exec(ctx, updateSessionTaskQuery, timeSpent, endedAt, status, notes, sessionTaskId, sessionId)
	if err != nil {
		return nil, fmt.Errorf("failed to update session task: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, fmt.Errorf("session task not found")
	}

	// Get the updated session task
	return GetSessionTaskByID(sessionTaskId, userId)
}

// DeleteSessionTask removes a task from a session
func DeleteSessionTask(sessionTaskId, sessionId uuid.UUID) error {
	conn := core.GetPool()
	ctx := context.Background()

	result, err := conn.Exec(ctx, deleteSessionTaskQuery, sessionTaskId, sessionId)
	if err != nil {
		return fmt.Errorf("failed to delete session task: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("session task not found")
	}

	return nil
}
