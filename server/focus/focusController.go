package focus

import (
	"io"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Task Management Handlers

// getTasks handles GET /api/v1/focus/tasks
func getTasks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	// Parse query parameters
	status := r.URL.Query().Get("status")
	priority := r.URL.Query().Get("priority")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	filters, err := ParseTaskFilters(status, priority, limitStr, offsetStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	response, err := service.GetTasks(userId, filters)
	if err != nil {
		logger().Error("Failed to get tasks", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to get tasks")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, response))
}

// getTask handles GET /api/v1/focus/tasks/{taskId}
func getTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	taskIdStr := chi.URLParam(r, "taskId")

	taskId, err := ValidateTaskId(taskIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	task, err := service.GetTask(taskId, userId)
	if err != nil {
		logger().Error("Failed to get task", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, task))
}

// createTask handles POST /api/v1/focus/tasks
func createTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateCreateTaskRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	task, err := service.CreateTask(userId, req)
	if err != nil {
		logger().Error("Failed to create task", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to create task")
		return
	}

	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, task))
}

// updateTask handles PUT /api/v1/focus/tasks/{taskId}
func updateTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	taskIdStr := chi.URLParam(r, "taskId")

	taskId, err := ValidateTaskId(taskIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateUpdateTaskRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	task, err := service.UpdateTask(taskId, userId, req)
	if err != nil {
		logger().Error("Failed to update task", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, task))
}

// deleteTask handles DELETE /api/v1/focus/tasks/{taskId}
func deleteTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	taskIdStr := chi.URLParam(r, "taskId")

	taskId, err := ValidateTaskId(taskIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	err = service.DeleteTask(taskId, userId)
	if err != nil {
		logger().Error("Failed to delete task", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, map[string]string{"message": "Task deleted successfully"}))
}

// updateTaskStatus handles PUT /api/v1/focus/tasks/{taskId}/status
func updateTaskStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	taskIdStr := chi.URLParam(r, "taskId")

	taskId, err := ValidateTaskId(taskIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateUpdateTaskStatusRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	task, err := service.UpdateTaskStatus(taskId, userId, req)
	if err != nil {
		logger().Error("Failed to update task status", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, task))
}

// updateTaskTime handles PUT /api/v1/focus/tasks/{taskId}/time
func updateTaskTime(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	taskIdStr := chi.URLParam(r, "taskId")

	taskId, err := ValidateTaskId(taskIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateUpdateTaskTimeRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	task, err := service.UpdateTaskTime(taskId, userId, req)
	if err != nil {
		logger().Error("Failed to update task time", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, task))
}

// reorderTasks handles PUT /api/v1/focus/tasks/reorder
func reorderTasks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateReorderTasksRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	err = service.ReorderTasks(userId, req)
	if err != nil {
		logger().Error("Failed to reorder tasks", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to reorder tasks")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, map[string]string{"message": "Tasks reordered successfully"}))
}

// Statistics Handler

// getStatistics handles GET /api/v1/focus/statistics
func getStatistics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	service := NewFocusService()
	stats, err := service.GetStatistics(userId)
	if err != nil {
		logger().Error("Failed to get statistics", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to get statistics")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, stats))
}

// Session Management Handlers

// getSessions handles GET /api/v1/focus/sessions
func getSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	// Parse query parameters
	status := r.URL.Query().Get("status")
	sessionType := r.URL.Query().Get("sessionType")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	filters, err := ParseSessionFilters(status, sessionType, limitStr, offsetStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	sessions, total, err := service.GetUserSessions(userId, filters)
	if err != nil {
		logger().Error("Failed to get sessions", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to get sessions")
		return
	}

	response := SessionListResponse{
		Sessions: sessions,
		Total:    total,
		Limit:    filters.Limit,
		Offset:   filters.Offset,
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, response))
}

// createSession handles POST /api/v1/focus/sessions
func createSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateCreateSessionRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	session, err := service.CreateSession(userId, req)
	if err != nil {
		logger().Error("Failed to create session", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Failed to create session")
		return
	}

	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, session))
}

// getSession handles GET /api/v1/focus/sessions/{sessionId}
func getSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	session, err := service.GetSession(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get session", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, session))
}

// endSession handles PUT /api/v1/focus/sessions/{sessionId}/end
func endSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateEndSessionRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	session, err := service.EndSession(sessionId, userId, req)
	if err != nil {
		logger().Error("Failed to end session", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, session))
}

// Session-Task Relationship Handlers

// getSessionTasks handles GET /api/v1/focus/sessions/{sessionId}/tasks
func getSessionTasks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	sessionTasks, err := service.GetSessionTasks(sessionId, userId)
	if err != nil {
		logger().Error("Failed to get session tasks", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, sessionTasks))
}

// addTaskToSession handles POST /api/v1/focus/sessions/{sessionId}/tasks
func addTaskToSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateAddTaskToSessionRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	sessionTask, err := service.AddTaskToSession(sessionId, userId, req)
	if err != nil {
		logger().Error("Failed to add task to session", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session or task not found")
		return
	}

	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, sessionTask))
}

// updateSessionTask handles PUT /api/v1/focus/sessions/{sessionId}/tasks/{sessionTaskId}
func updateSessionTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")
	sessionTaskIdStr := chi.URLParam(r, "sessionTaskId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	sessionTaskId, err := ValidateTaskId(sessionTaskIdStr) // Reusing task ID validation for session task ID
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	// Read and validate request body
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	req, err := ValidateUpdateSessionTaskRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	sessionTask, err := service.UpdateSessionTask(sessionTaskId, sessionId, userId, req)
	if err != nil {
		logger().Error("Failed to update session task", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, sessionTask))
}

// removeTaskFromSession handles DELETE /api/v1/focus/sessions/{sessionId}/tasks/{sessionTaskId}
func removeTaskFromSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	userId := uuid.MustParse(user.AId)
	sessionIdStr := chi.URLParam(r, "sessionId")
	sessionTaskIdStr := chi.URLParam(r, "sessionTaskId")

	sessionId, err := ValidateSessionId(sessionIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	sessionTaskId, err := ValidateTaskId(sessionTaskIdStr) // Reusing task ID validation for session task ID
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	service := NewFocusService()
	err = service.RemoveTaskFromSession(sessionTaskId, sessionId, userId)
	if err != nil {
		logger().Error("Failed to remove task from session", zap.Error(err))
		core.SendFailedReponse(w, r, http.StatusNotFound, "Session task not found")
		return
	}

	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, map[string]string{"message": "Task removed from session successfully"}))
}

// Router sets up the focus API routes
func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)

	// Task management routes
	r.Get("/tasks", getTasks)
	r.Post("/tasks", createTask)
	r.Get("/tasks/{taskId}", getTask)
	r.Put("/tasks/{taskId}", updateTask)
	r.Delete("/tasks/{taskId}", deleteTask)
	r.Put("/tasks/{taskId}/status", updateTaskStatus)
	r.Put("/tasks/{taskId}/time", updateTaskTime)
	r.Put("/tasks/reorder", reorderTasks)

	// Session management routes
	r.Get("/sessions", getSessions)
	r.Post("/sessions", createSession)
	r.Get("/sessions/{sessionId}", getSession)
	r.Put("/sessions/{sessionId}/end", endSession)

	// Session-task relationship routes
	r.Get("/sessions/{sessionId}/tasks", getSessionTasks)
	r.Post("/sessions/{sessionId}/tasks", addTaskToSession)
	r.Put("/sessions/{sessionId}/tasks/{sessionTaskId}", updateSessionTask)
	r.Delete("/sessions/{sessionId}/tasks/{sessionTaskId}", removeTaskFromSession)

	// Statistics routes
	r.Get("/statistics", getStatistics)

	return r
}
