package notification

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Controller struct {
	service *Service
}

func NewController() *Controller {
	return &Controller{service: NewService()}
}

func (c *Controller) Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)
	r.Get("/", c.list)
	r.Get("/unread-count", c.unreadCount)
	r.Post("/read", c.markRead)
	r.Post("/read-all", c.markAllRead)
	r.Post("/{notificationId}/dismiss", c.dismiss)
	return r
}

func currentNotificationUser(r *http.Request) (uuid.UUID, bool) {
	user, err := core.GetUserInfo(r.Context())
	if err != nil || user.AId == "" {
		return uuid.Nil, false
	}
	userID, err := uuid.Parse(user.AId)
	if err != nil {
		return uuid.Nil, false
	}
	return userID, true
}

func (c *Controller) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentNotificationUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	limit := 50
	if parsed, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	resp, err := c.service.ListInAppNotifications(r.Context(), userID, r.URL.Query().Get("filter"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, resp)
}

func (c *Controller) unreadCount(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentNotificationUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	count, err := c.service.CountInAppNotifications(r.Context(), userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to count notifications")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, count)
}

func (c *Controller) markRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentNotificationUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	var req MarkNotificationsReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	if err := c.service.MarkInAppNotificationsRead(r.Context(), userID, req.NotificationIDs); err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to mark notifications read")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"updated": true})
}

func (c *Controller) markAllRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentNotificationUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	var req MarkAllNotificationsReadRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	category := ""
	if req.Category != nil {
		category = *req.Category
	}
	if err := c.service.MarkAllInAppNotificationsRead(r.Context(), userID, category); err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to mark notifications read")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"updated": true})
}

func (c *Controller) dismiss(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentNotificationUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	notificationID, err := uuid.Parse(chi.URLParam(r, "notificationId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid notification id")
		return
	}
	if err := c.service.DismissInAppNotification(r.Context(), userID, notificationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusConflict, "notification cannot be dismissed")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to dismiss notification")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"dismissed": true})
}
