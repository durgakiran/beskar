package focus

import (
	"time"

	"github.com/google/uuid"
)

// Task represents a focus task
type Task struct {
	ID                 uuid.UUID  `json:"id" db:"id"`
	UserID             uuid.UUID  `json:"userId" db:"user_id"`
	Title              string     `json:"title" db:"title"`
	Description        string     `json:"description" db:"description"`
	EstimatedTime      int        `json:"estimatedTime" db:"estimated_time"`
	TotalCompletedTime int        `json:"totalCompletedTime" db:"total_completed_time"`
	Status             string     `json:"status" db:"status"`
	Priority           string     `json:"priority" db:"priority"`
	TaskOrder          int        `json:"taskOrder" db:"task_order"`
	CreatedAt          time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt          time.Time  `json:"updatedAt" db:"updated_at"`
	DeletedAt          *time.Time `json:"deletedAt" db:"deleted_at"`
}

// Session represents a focus session
type Session struct {
	ID             uuid.UUID  `json:"id" db:"id"`
	UserID         uuid.UUID  `json:"userId" db:"user_id"`
	SessionType    string     `json:"sessionType" db:"session_type"`
	Duration       int        `json:"duration" db:"duration"`
	ActualDuration *int       `json:"actualDuration" db:"actual_duration"`
	StartedAt      time.Time  `json:"startedAt" db:"started_at"`
	EndedAt        *time.Time `json:"endedAt" db:"ended_at"`
	Status         string     `json:"status" db:"status"`
	Notes          string     `json:"notes" db:"notes"`
}

// SessionTask represents the relationship between sessions and tasks
type SessionTask struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	SessionID       uuid.UUID  `json:"sessionId" db:"session_id"`
	TaskID          uuid.UUID  `json:"taskId" db:"task_id"`
	TimeSpent       int        `json:"timeSpent" db:"time_spent"`
	StartedAt       time.Time  `json:"startedAt" db:"started_at"`
	EndedAt         *time.Time `json:"endedAt" db:"ended_at"`
	Status          string     `json:"status" db:"status"`
	Notes           string     `json:"notes" db:"notes"`
	TaskTitle       string     `json:"taskTitle" db:"task_title"`
	TaskDescription string     `json:"taskDescription" db:"task_description"`
	TaskPriority    string     `json:"taskPriority" db:"task_priority"`
}

// Request/Response types

// CreateTaskRequest represents the request to create a new task
type CreateTaskRequest struct {
	Title         string `json:"title" validate:"required,min=1,max=255"`
	Description   string `json:"description" validate:"max=1000"`
	EstimatedTime int    `json:"estimatedTime" validate:"required,min=1,max=1440"`
	Priority      string `json:"priority" validate:"required,oneof=low medium high"`
}

// UpdateTaskRequest represents the request to update a task
type UpdateTaskRequest struct {
	Title         *string `json:"title" validate:"omitempty,min=1,max=255"`
	Description   *string `json:"description" validate:"omitempty,max=1000"`
	EstimatedTime *int    `json:"estimatedTime" validate:"omitempty,min=1,max=1440"`
	Priority      *string `json:"priority" validate:"omitempty,oneof=low medium high"`
	Status        *string `json:"status" validate:"omitempty,oneof=pending in-progress completed"`
}

// UpdateTaskStatusRequest represents the request to update task status
type UpdateTaskStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=pending in-progress completed"`
}

// UpdateTaskTimeRequest represents the request to update task completed time
type UpdateTaskTimeRequest struct {
	CompletedTime int `json:"completedTime" validate:"required,min=0,max=1440"`
}

// ReorderTasksRequest represents the request to reorder tasks
type ReorderTasksRequest struct {
	TaskOrders []TaskOrderItem `json:"taskOrders" validate:"required,min=1"`
}

// TaskOrderItem represents a single task order update
type TaskOrderItem struct {
	TaskID    uuid.UUID `json:"taskId" validate:"required"`
	TaskOrder int       `json:"taskOrder" validate:"required,min=0"`
}

// CreateSessionRequest represents the request to create a new session
type CreateSessionRequest struct {
	SessionType string `json:"sessionType" validate:"required,oneof=pomodoro break long_break"`
	Duration    int    `json:"duration" validate:"required,min=1,max=1440"`
	Notes       string `json:"notes" validate:"max=1000"`
}

// EndSessionRequest represents the request to end a session
type EndSessionRequest struct {
	ActualDuration int    `json:"actualDuration" validate:"required,min=1,max=1440"`
	Status         string `json:"status" validate:"required,oneof=completed interrupted"`
}

// AddTaskToSessionRequest represents the request to add a task to a session
type AddTaskToSessionRequest struct {
	TaskID    uuid.UUID `json:"taskId" validate:"required"`
	TimeSpent int       `json:"timeSpent" validate:"required,min=1,max=1440"`
	Notes     string    `json:"notes" validate:"max=1000"`
}

// UpdateSessionTaskRequest represents the request to update task time in session
type UpdateSessionTaskRequest struct {
	TimeSpent int    `json:"timeSpent" validate:"required,min=1,max=1440"`
	Status    string `json:"status" validate:"required,oneof=active completed paused"`
}

// TaskListResponse represents the response for task listing
type TaskListResponse struct {
	Tasks  []Task `json:"tasks"`
	Total  int    `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

// SessionListResponse represents the response for session listing
type SessionListResponse struct {
	Sessions []Session `json:"sessions"`
	Total    int       `json:"total"`
	Limit    int       `json:"limit"`
	Offset   int       `json:"offset"`
}

// Statistics represents focus statistics
type Statistics struct {
	TotalTasks            int     `json:"totalTasks"`
	CompletedTasks        int     `json:"completedTasks"`
	TotalEstimatedTime    int     `json:"totalEstimatedTime"`
	TotalCompletedTime    int     `json:"totalCompletedTime"`
	AverageCompletionTime float64 `json:"averageCompletionTime"`
	TotalSessions         int     `json:"totalSessions"`
	TotalSessionTime      int     `json:"totalSessionTime"`
	ProductivityScore     float64 `json:"productivityScore"`
}

// DailyStatistics represents daily focus statistics
type DailyStatistics struct {
	Date              string `json:"date"`
	TasksCompleted    int    `json:"tasksCompleted"`
	TimeSpent         int    `json:"timeSpent"`
	SessionsCompleted int    `json:"sessionsCompleted"`
}

// TaskFilters represents filters for task queries
type TaskFilters struct {
	Status   string
	Priority string
	Limit    int
	Offset   int
}

// SessionFilters represents filters for session queries
type SessionFilters struct {
	Status      string
	SessionType string
	Limit       int
	Offset      int
}
