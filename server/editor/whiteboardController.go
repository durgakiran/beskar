package editor

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

	outputDoc, err := FetchPublishedWhiteboard(inputDoc)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			draft, draftErr := FetchWhiteboardToEdit(inputDoc)
			if draftErr == nil && draft.Title != "" {
				core.SendSuccessResponse(w, r, http.StatusOK, map[string]interface{}{
					"title": draft.Title,
				})
			} else {
				core.SendSuccessResponse(w, r, http.StatusOK, nil)
			}
			return
		}
		logger().Error(fmt.Sprintf("getWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not get Whiteboard")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, outputDoc)
}

func getWhiteboardToEdit(w http.ResponseWriter, r *http.Request) {
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
	if !ensureMutableSpace(w, r, spaceId) {
		return
	}

	inputDoc := WhiteboardInput{
		Id:      pageId,
		SpaceId: spaceId,
	}

	outputDoc, err := FetchWhiteboardToEdit(inputDoc)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Whiteboard not found")
			return
		}
		logger().Error(fmt.Sprintf("getWhiteboardToEdit: %s", err.Error()))
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

func publishWhiteboard(w http.ResponseWriter, r *http.Request) {
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
	if !ensureMutableSpace(w, r, spaceId) {
		return
	}

	data, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	
	// Re-use update validator or make a new one, but for now we expect same payload structure + previewAssetName
	inputDoc, err := ValidateWhiteboardUpdate(data)
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid Document Data Format")
		return
	}

	publishInput := WhiteboardPublishInput{
		Id:               pageId,
		SpaceId:          spaceId,
		OwnerId:          userId,
		Data:             inputDoc.Data,
		PreviewAssetName: inputDoc.PreviewAssetName,
	}

	err = PublishWhiteboard(publishInput)
	if err != nil {
		logger().Error(fmt.Sprintf("publishWhiteboard: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not publish Whiteboard")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, "Whiteboard published successfully")
}

func listWhiteboardVersions(w http.ResponseWriter, r *http.Request) {
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

	pageIdStr := chi.URLParam(r, "pageId")
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	hasPermission := core.ValidateUserPagePermission(pageIdStr, userId, "view")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Permission Denied: User cannot view whiteboard versions")
		return
	}

	versions, err := ListWhiteboardVersions(pageId)
	if err != nil {
		logger().Error(fmt.Sprintf("listWhiteboardVersions: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not get whiteboard versions")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, versions)
}

func getWhiteboardVersionByDocId(w http.ResponseWriter, r *http.Request) {
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
	_, err = strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}
	
	docIdStr := chi.URLParam(r, "docId")
	docId, err := strconv.ParseInt(docIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid doc ID")
		return
	}

	hasPermission := core.ValidateUserPagePermission(pageIdStr, userId, "view")
	if !hasPermission {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Permission Denied: User cannot view whiteboard version")
		return
	}

	outputDoc, err := FetchWhiteboardByDocId(docId, spaceId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Whiteboard version not found")
			return
		}
		logger().Error(fmt.Sprintf("getWhiteboardVersionByDocId: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not get Whiteboard version")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, outputDoc)
}
