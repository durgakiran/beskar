package focus

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
)

var validate = validator.New()

// ValidateCreateTaskRequest validates the request to create a new task
func ValidateCreateTaskRequest(data []byte) (*CreateTaskRequest, error) {
	var req CreateTaskRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateUpdateTaskRequest validates the request to update a task
func ValidateUpdateTaskRequest(data []byte) (*UpdateTaskRequest, error) {
	var req UpdateTaskRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateUpdateTaskStatusRequest validates the request to update task status
func ValidateUpdateTaskStatusRequest(data []byte) (*UpdateTaskStatusRequest, error) {
	var req UpdateTaskStatusRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateUpdateTaskTimeRequest validates the request to update task completed time
func ValidateUpdateTaskTimeRequest(data []byte) (*UpdateTaskTimeRequest, error) {
	var req UpdateTaskTimeRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateCreateSessionRequest validates the request to create a new session
func ValidateCreateSessionRequest(data []byte) (*CreateSessionRequest, error) {
	var req CreateSessionRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateEndSessionRequest validates the request to end a session
func ValidateEndSessionRequest(data []byte) (*EndSessionRequest, error) {
	var req EndSessionRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateAddTaskToSessionRequest validates the request to add a task to a session
func ValidateAddTaskToSessionRequest(data []byte) (*AddTaskToSessionRequest, error) {
	var req AddTaskToSessionRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateUpdateSessionTaskRequest validates the request to update task time in session
func ValidateUpdateSessionTaskRequest(data []byte) (*UpdateSessionTaskRequest, error) {
	var req UpdateSessionTaskRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	return &req, nil
}

// ValidateTaskId validates and parses a task ID string to UUID
func ValidateTaskId(taskId string) (uuid.UUID, error) {
	if taskId == "" {
		return uuid.Nil, fmt.Errorf("task ID is required")
	}

	parsedUUID, err := uuid.Parse(taskId)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid task ID format: %w", err)
	}

	return parsedUUID, nil
}

// ValidateSessionId validates and parses a session ID string to UUID
func ValidateSessionId(sessionId string) (uuid.UUID, error) {
	if sessionId == "" {
		return uuid.Nil, fmt.Errorf("session ID is required")
	}

	parsedUUID, err := uuid.Parse(sessionId)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid session ID format: %w", err)
	}

	return parsedUUID, nil
}

// ParseTaskFilters parses and validates task filter parameters
func ParseTaskFilters(status, priority, limitStr, offsetStr string) (*TaskFilters, error) {
	filters := &TaskFilters{
		Status:   status,
		Priority: priority,
		Limit:    10, // default limit
		Offset:   0,  // default offset
	}

	// Validate status if provided
	if status != "" {
		if status != "pending" && status != "in-progress" && status != "completed" {
			return nil, fmt.Errorf("invalid status: must be pending, in-progress, or completed")
		}
	}

	// Validate priority if provided
	if priority != "" {
		if priority != "low" && priority != "medium" && priority != "high" {
			return nil, fmt.Errorf("invalid priority: must be low, medium, or high")
		}
	}

	// Parse and validate limit
	if limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil {
			return nil, fmt.Errorf("invalid limit: must be a number")
		}
		if limit <= 0 || limit > 100 {
			return nil, fmt.Errorf("limit must be between 1 and 100")
		}
		filters.Limit = limit
	}

	// Parse and validate offset
	if offsetStr != "" {
		offset, err := strconv.Atoi(offsetStr)
		if err != nil {
			return nil, fmt.Errorf("invalid offset: must be a number")
		}
		if offset < 0 {
			return nil, fmt.Errorf("offset must be non-negative")
		}
		filters.Offset = offset
	}

	return filters, nil
}

// ParseSessionFilters parses and validates session filter parameters
func ParseSessionFilters(status, sessionType, limitStr, offsetStr string) (*SessionFilters, error) {
	filters := &SessionFilters{
		Status:      status,
		SessionType: sessionType,
		Limit:       10, // default limit
		Offset:      0,  // default offset
	}

	// Validate status if provided
	if status != "" {
		if status != "active" && status != "completed" && status != "interrupted" {
			return nil, fmt.Errorf("invalid status: must be active, completed, or interrupted")
		}
	}

	// Validate session type if provided
	if sessionType != "" {
		if sessionType != "pomodoro" && sessionType != "break" && sessionType != "long_break" {
			return nil, fmt.Errorf("invalid session type: must be pomodoro, break, or long_break")
		}
	}

	// Parse and validate limit
	if limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil {
			return nil, fmt.Errorf("invalid limit: must be a number")
		}
		if limit <= 0 || limit > 100 {
			return nil, fmt.Errorf("limit must be between 1 and 100")
		}
		filters.Limit = limit
	}

	// Parse and validate offset
	if offsetStr != "" {
		offset, err := strconv.Atoi(offsetStr)
		if err != nil {
			return nil, fmt.Errorf("invalid offset: must be a number")
		}
		if offset < 0 {
			return nil, fmt.Errorf("offset must be non-negative")
		}
		filters.Offset = offset
	}

	return filters, nil
}

// ValidateReorderTasksRequest validates the request to reorder tasks
func ValidateReorderTasksRequest(data []byte) (*ReorderTasksRequest, error) {
	var req ReorderTasksRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %w", err)
	}

	if err := validate.Struct(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Additional validation: ensure no duplicate task IDs
	taskIDMap := make(map[uuid.UUID]bool)
	for _, item := range req.TaskOrders {
		if taskIDMap[item.TaskID] {
			return nil, fmt.Errorf("duplicate task ID found: %s", item.TaskID)
		}
		taskIDMap[item.TaskID] = true
	}

	return &req, nil
}
