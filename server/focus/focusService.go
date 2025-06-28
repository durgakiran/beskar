package focus

import (
	"fmt"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

// FocusService provides business logic for focus operations
type FocusService struct{}

// NewFocusService creates a new focus service instance
func NewFocusService() *FocusService {
	return &FocusService{}
}

// GetTasks retrieves tasks for a user with filtering and pagination
func (s *FocusService) GetTasks(userId uuid.UUID, filters *TaskFilters) (*TaskListResponse, error) {
	tasks, total, err := GetUserTasks(userId, filters)
	if err != nil {
		logger().Error("Failed to get user tasks", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	return &TaskListResponse{
		Tasks:  tasks,
		Total:  total,
		Limit:  filters.Limit,
		Offset: filters.Offset,
	}, nil
}

// GetTask retrieves a specific task by ID
func (s *FocusService) GetTask(taskId, userId uuid.UUID) (*Task, error) {
	task, err := GetTaskByID(taskId, userId)
	if err != nil {
		logger().Error("Failed to get task", zap.Error(err), zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	return task, nil
}

// CreateTask creates a new task for a user
func (s *FocusService) CreateTask(userId uuid.UUID, req *CreateTaskRequest) (*Task, error) {
	// Generate new task ID
	taskId := uuid.New()

	// Create task object
	task := &Task{
		ID:                 taskId,
		UserID:             userId,
		Title:              req.Title,
		Description:        req.Description,
		EstimatedTime:      req.EstimatedTime,
		TotalCompletedTime: 0,
		Status:             "pending",
		Priority:           req.Priority,
	}

	// Save to database
	err := CreateTask(task)
	if err != nil {
		logger().Error("Failed to create task", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Task created successfully", zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
	return task, nil
}

// UpdateTask updates an existing task
func (s *FocusService) UpdateTask(taskId, userId uuid.UUID, req *UpdateTaskRequest) (*Task, error) {
	// Build updates map
	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.EstimatedTime != nil {
		updates["estimated_time"] = *req.EstimatedTime
	}
	if req.Priority != nil {
		updates["priority"] = *req.Priority
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}

	// Update task
	task, err := UpdateTask(taskId, userId, updates)
	if err != nil {
		logger().Error("Failed to update task", zap.Error(err), zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Task updated successfully", zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
	return task, nil
}

// DeleteTask soft deletes a task
func (s *FocusService) DeleteTask(taskId, userId uuid.UUID) error {
	err := DeleteTask(taskId, userId)
	if err != nil {
		logger().Error("Failed to delete task", zap.Error(err), zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
		return err
	}

	logger().Info("Task deleted successfully", zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
	return nil
}

// UpdateTaskStatus updates the status of a task
func (s *FocusService) UpdateTaskStatus(taskId, userId uuid.UUID, req *UpdateTaskStatusRequest) (*Task, error) {
	task, err := UpdateTaskStatus(taskId, userId, req.Status)
	if err != nil {
		logger().Error("Failed to update task status", zap.Error(err), zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Task status updated successfully", zap.String("taskId", taskId.String()), zap.String("status", req.Status), zap.String("userId", userId.String()))
	return task, nil
}

// UpdateTaskTime updates the completed time of a task
func (s *FocusService) UpdateTaskTime(taskId, userId uuid.UUID, req *UpdateTaskTimeRequest) (*Task, error) {
	task, err := UpdateTaskTime(taskId, userId, req.CompletedTime)
	if err != nil {
		logger().Error("Failed to update task time", zap.Error(err), zap.String("taskId", taskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Task time updated successfully", zap.String("taskId", taskId.String()), zap.Int("completedTime", req.CompletedTime), zap.String("userId", userId.String()))
	return task, nil
}

// ReorderTasks updates the order of multiple tasks
func (s *FocusService) ReorderTasks(userId uuid.UUID, req *ReorderTasksRequest) error {
	err := ReorderTasks(userId, req.TaskOrders)
	if err != nil {
		logger().Error("Failed to reorder tasks", zap.Error(err), zap.String("userId", userId.String()))
		return err
	}

	logger().Info("Tasks reordered successfully", zap.String("userId", userId.String()), zap.Int("taskCount", len(req.TaskOrders)))
	return nil
}

// GetSessions retrieves sessions for a user with filtering and pagination
func (s *FocusService) GetSessions(userId uuid.UUID, filters *SessionFilters) (*SessionListResponse, error) {
	sessions, total, err := GetUserSessions(userId, filters)
	if err != nil {
		logger().Error("Failed to get user sessions", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	return &SessionListResponse{
		Sessions: sessions,
		Total:    total,
		Limit:    filters.Limit,
		Offset:   filters.Offset,
	}, nil
}

// GetUserSessions retrieves sessions for a user with filtering and pagination (alias for GetSessions)
func (s *FocusService) GetUserSessions(userId uuid.UUID, filters *SessionFilters) ([]Session, int, error) {
	return GetUserSessions(userId, filters)
}

// GetSession retrieves a specific session by ID
func (s *FocusService) GetSession(sessionId, userId uuid.UUID) (*Session, error) {
	session, err := GetSessionByID(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get session", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	return session, nil
}

// CreateSession creates a new session for a user
func (s *FocusService) CreateSession(userId uuid.UUID, req *CreateSessionRequest) (*Session, error) {
	// Generate new session ID
	sessionId := uuid.New()

	// Create session object
	session := &Session{
		ID:          sessionId,
		UserID:      userId,
		SessionType: req.SessionType,
		Duration:    req.Duration,
		Status:      "active",
		Notes:       req.Notes,
	}

	// Save to database
	err := CreateSession(session)
	if err != nil {
		logger().Error("Failed to create session", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Session created successfully", zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
	return session, nil
}

// EndSession ends an active session
func (s *FocusService) EndSession(sessionId, userId uuid.UUID, req *EndSessionRequest) (*Session, error) {
	err := EndSession(sessionId, userId, req.ActualDuration, req.Status)
	if err != nil {
		logger().Error("Failed to end session", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	// Get the updated session
	session, err := s.GetSession(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get updated session", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Session ended successfully", zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
	return session, nil
}

// GetStatistics calculates and returns focus statistics for a user
func (s *FocusService) GetStatistics(userId uuid.UUID) (*Statistics, error) {
	// Get all tasks for the user
	taskFilters := &TaskFilters{
		Limit:  1000, // Get all tasks for statistics
		Offset: 0,
	}
	tasks, _, err := GetUserTasks(userId, taskFilters)
	if err != nil {
		logger().Error("Failed to get tasks for statistics", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	// Get all sessions for the user
	sessionFilters := &SessionFilters{
		Limit:  1000, // Get all sessions for statistics
		Offset: 0,
	}
	sessions, _, err := GetUserSessions(userId, sessionFilters)
	if err != nil {
		logger().Error("Failed to get sessions for statistics", zap.Error(err), zap.String("userId", userId.String()))
		return nil, err
	}

	// Calculate statistics
	stats := &Statistics{
		TotalTasks:         len(tasks),
		TotalSessions:      len(sessions),
		TotalEstimatedTime: 0,
		TotalCompletedTime: 0,
		TotalSessionTime:   0,
	}

	completedTasks := 0
	for _, task := range tasks {
		stats.TotalEstimatedTime += task.EstimatedTime
		stats.TotalCompletedTime += task.TotalCompletedTime
		if task.Status == "completed" {
			completedTasks++
		}
	}
	stats.CompletedTasks = completedTasks

	// Calculate average completion time
	if completedTasks > 0 {
		stats.AverageCompletionTime = float64(stats.TotalCompletedTime) / float64(completedTasks)
	}

	// Calculate total session time
	for _, session := range sessions {
		if session.ActualDuration != nil {
			stats.TotalSessionTime += *session.ActualDuration
		}
	}

	// Calculate productivity score (completed time vs estimated time)
	if stats.TotalEstimatedTime > 0 {
		stats.ProductivityScore = (float64(stats.TotalCompletedTime) / float64(stats.TotalEstimatedTime)) * 100
	}

	return stats, nil
}

// Session-Task Relationship Methods

// GetSessionTasks retrieves all tasks for a specific session
func (s *FocusService) GetSessionTasks(sessionId, userId uuid.UUID) ([]SessionTask, error) {
	sessionTasks, err := GetSessionTasks(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get session tasks", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	return sessionTasks, nil
}

// GetSessionTask retrieves a specific session task by ID
func (s *FocusService) GetSessionTask(sessionTaskId, userId uuid.UUID) (*SessionTask, error) {
	sessionTask, err := GetSessionTaskByID(sessionTaskId, userId)
	if err != nil {
		logger().Error("Failed to get session task", zap.Error(err), zap.String("sessionTaskId", sessionTaskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	return sessionTask, nil
}

// AddTaskToSession adds a task to a session
func (s *FocusService) AddTaskToSession(sessionId, userId uuid.UUID, req *AddTaskToSessionRequest) (*SessionTask, error) {
	// Verify the session exists and belongs to the user
	_, err := s.GetSession(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get session for task addition", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	// Verify the task exists and belongs to the user
	task, err := s.GetTask(req.TaskID, userId)
	if err != nil {
		logger().Error("Failed to get task for session addition", zap.Error(err), zap.String("taskId", req.TaskID.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	// Generate new session task ID
	sessionTaskId := uuid.New()

	// Create session task object
	sessionTask := &SessionTask{
		ID:        sessionTaskId,
		SessionID: sessionId,
		TaskID:    req.TaskID,
		TimeSpent: req.TimeSpent,
		Status:    "active",
		Notes:     req.Notes,
	}

	// Save to database
	err = CreateSessionTask(sessionTask)
	if err != nil {
		logger().Error("Failed to create session task", zap.Error(err), zap.String("sessionId", sessionId.String()), zap.String("taskId", req.TaskID.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	// Add task details to the response
	sessionTask.TaskTitle = task.Title
	sessionTask.TaskDescription = task.Description
	sessionTask.TaskPriority = task.Priority

	logger().Info("Task added to session successfully", zap.String("sessionTaskId", sessionTaskId.String()), zap.String("sessionId", sessionId.String()), zap.String("taskId", req.TaskID.String()), zap.String("userId", userId.String()))
	return sessionTask, nil
}

// UpdateSessionTask updates a task within a session
func (s *FocusService) UpdateSessionTask(sessionTaskId, sessionId, userId uuid.UUID, req *UpdateSessionTaskRequest) (*SessionTask, error) {
	// Verify the session task exists and belongs to the user
	existingSessionTask, err := s.GetSessionTask(sessionTaskId, userId)
	if err != nil {
		logger().Error("Failed to get session task for update", zap.Error(err), zap.String("sessionTaskId", sessionTaskId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	// Verify the session ID matches
	if existingSessionTask.SessionID != sessionId {
		return nil, fmt.Errorf("session task does not belong to the specified session")
	}

	// Update the session task
	sessionTask, err := UpdateSessionTask(sessionTaskId, sessionId, userId, req.TimeSpent, req.Status, "")
	if err != nil {
		logger().Error("Failed to update session task", zap.Error(err), zap.String("sessionTaskId", sessionTaskId.String()), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return nil, err
	}

	logger().Info("Session task updated successfully", zap.String("sessionTaskId", sessionTaskId.String()), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
	return sessionTask, nil
}

// RemoveTaskFromSession removes a task from a session
func (s *FocusService) RemoveTaskFromSession(sessionTaskId, sessionId, userId uuid.UUID) error {
	// Verify the session task exists and belongs to the user
	existingSessionTask, err := s.GetSessionTask(sessionTaskId, userId)
	if err != nil {
		logger().Error("Failed to get session task for removal", zap.Error(err), zap.String("sessionTaskId", sessionTaskId.String()), zap.String("userId", userId.String()))
		return err
	}

	// Verify the session ID matches
	if existingSessionTask.SessionID != sessionId {
		return fmt.Errorf("session task does not belong to the specified session")
	}

	// Remove the session task
	err = DeleteSessionTask(sessionTaskId, sessionId)
	if err != nil {
		logger().Error("Failed to delete session task", zap.Error(err), zap.String("sessionTaskId", sessionTaskId.String()), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
		return err
	}

	logger().Info("Task removed from session successfully", zap.String("sessionTaskId", sessionTaskId.String()), zap.String("sessionId", sessionId.String()), zap.String("userId", userId.String()))
	return nil
}
