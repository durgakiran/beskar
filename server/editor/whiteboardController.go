package editor

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func createWhiteboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	userIdStr := user.AId
	userId, err := uuid.Parse(userIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid user ID Format")
		return
	}

	spaceId, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space UUID")
		return
	}

	data, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}

	inputDoc, err := ValidateWhiteboardCreate(data)
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid Document Data Format")
		return
	}

	inputDoc.SpaceId = spaceId
	inputDoc.OwnerId = userId

	// Authorization Check: Does the user have permission to create pages in this space?
	hasPermission := core.ValidateUserSpacePermissions(inputDoc.SpaceId, inputDoc.OwnerId, "edit_page")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Not enough permissions to add whiteboard to space")
		return
	}
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}

	pageId, err := CreateWhiteboard(inputDoc)
	if err != nil {
		logger().Error(fmt.Sprintf("createWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not create Whiteboard")
		return
	}

	type PageId struct {
		Page int64 `json:"page"`
	}
	core.SendSuccessResponse(w, r, http.StatusCreated, PageId{Page: pageId})
}

func getWhiteboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	userIdStr := user.AId
	userId, err := uuid.Parse(userIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid user ID Format")
		return
	}
	spaceId, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space UUID")
		return
	}

	pageIdStr := chi.URLParam(r, "pageId")
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	hasPermission := core.ValidateUserPagePermission(pageIdStr, userId, "view")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Permission Denied: User cannot view whiteboard")
		return
	}

	inputDoc := WhiteboardInput{
		Id:      pageId,
		SpaceId: spaceId,
	}

	outputDoc, err := FetchWhiteboard(inputDoc)
	if err != nil {
		logger().Error(fmt.Sprintf("getWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not get Whiteboard")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, outputDoc)
}

func updateWhiteboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	userIdStr := user.AId
	userId, err := uuid.Parse(userIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid user ID Format")
		return
	}

	spaceId, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space UUID")
		return
	}

	pageIdStr := chi.URLParam(r, "pageId")
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	hasPermission := core.ValidateUserPagePermission(pageIdStr, userId, "edit")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Permission Denied: User cannot edit whiteboard")
		return
	}

	data, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}

	inputDoc, err := ValidateWhiteboardUpdate(data)
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid Document Data Format")
		return
	}

	inputDoc.SpaceId = spaceId
	inputDoc.OwnerId = userId
	inputDoc.Id = pageId // From URL
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}

	err = UpdateWhiteboard(inputDoc)
	if err != nil {
		logger().Error(fmt.Sprintf("updateWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not update Whiteboard")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, "Whiteboard updated")
}

func deleteWhiteboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	userIdStr := user.AId
	userId, err := uuid.Parse(userIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid user ID Format")
		return
	}

	spaceId, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space UUID")
		return
	}

	pageIdStr := chi.URLParam(r, "pageId")
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	hasPermission := core.ValidateUserPagePermission(pageIdStr, userId, "delete")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Permission Denied: User cannot delete whiteboard")
		return
	}

	inputDoc := WhiteboardInput{
		SpaceId: spaceId,
		Id:      pageId,
		OwnerId: userId,
	}
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}

	err = DeleteWhiteboard(inputDoc)
	if err != nil {
		logger().Error(fmt.Sprintf("deleteWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not delete Whiteboard")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, "Whiteboard is successfully deleted")
}
