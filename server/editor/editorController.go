package editor

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

func ensureMutableSpace(w http.ResponseWriter, r *http.Request, spaceId uuid.UUID) bool {
	err := core.ValidateSpaceMutable(spaceId)
	if err == nil {
		return true
	}
	if err.Error() == "space has been deleted" {
		core.SendFailedReponse(w, r, http.StatusNotFound, err.Error())
		return false
	}
	if err.Error() == "space is archived" {
		core.SendFailedReponse(w, r, http.StatusForbidden, "This space is archived and read-only")
		return false
	}
	core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to validate space state")
	return false
}

func getDocumentToView(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	ownerId := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageId := chi.URLParam(r, "pageId")
	validSpaceUserPermissions := core.ValidateUserPagePermission(pageId, ownerId, "view")
	if !validSpaceUserPermissions {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	outputDocument, err := GetDocumentView(page, spaceId, ownerId)
	if errors.Is(err, pgx.ErrNoRows) {
		core.SendSuccessResponse(w, r, http.StatusOK, nil)
		return
	}
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, outputDocument)
}

func getDocumentToEdit(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	ownerId := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageId := chi.URLParam(r, "pageId")
	validSpaceUserPermissions := core.ValidateUserPagePermission(pageId, ownerId, "edit")
	if !validSpaceUserPermissions {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceId) {
		return
	}
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	outputDocument, err := GetDocumentToEdit(page, spaceId, ownerId)
	if errors.Is(err, pgx.ErrNoRows) {
		core.SendSuccessResponse(w, r, http.StatusOK, nil)
		return
	}
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, outputDocument)
}

func saveDoc(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}
	inputDoc, err := ValidateNewDoc(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to process request body")
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := core.ValidateUserSpacePermissions(inputDoc.SpaceId, inputDoc.OwnerId, "edit_page")
	if !validSpaceUserPermissions {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}
	pageId, err := inputDoc.Create()
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to create new page")
		return
	}
	type PageId struct {
		Page int64 `json:"page"`
	}
	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, PageId{Page: pageId}))
}

func publishDoc(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, core.FAILURE, "Unable to read request body"))
		return
	}
	inputDoc, err := ValidateNewDoc(data)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, core.FAILURE, "Unable to process request body"))
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := core.ValidateUserPagePermission(fmt.Sprintf("%v", inputDoc.Id), inputDoc.OwnerId, "edit")
	if !validSpaceUserPermissions {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, core.FAILURE, "Invalid space permissions"))
		return
	}
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}
	pageId, err := inputDoc.Publish()
	if err != nil && err.Error() == "nothing new to update" {
		render.Status(r, http.StatusConflict)
		render.Render(w, r, core.NewFailedResponse(http.StatusConflict, core.FAILURE, core.FAILURE, "There is nothing new to update"))
		return
	}
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, core.FAILURE, "Unable to update document"))
		return
	}

	type PageId struct {
		Page int64 `json:"page"`
	}
	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, PageId{Page: pageId}))
}

func updateDraftDoc(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, core.FAILURE, "Unable to read request body"))
		return
	}
	inputDoc, err := ValidateNewDraftDoc(data)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, core.FAILURE, "Unable to process request body"))
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := core.ValidateUserPagePermission(fmt.Sprintf("%v", inputDoc.Id), inputDoc.OwnerId, "edit")
	if !validSpaceUserPermissions {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, core.FAILURE, "Invalid space permissions"))
		return
	}
	if !ensureMutableSpace(w, r, inputDoc.SpaceId) {
		return
	}
	pageId, err := inputDoc.Update()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, core.FAILURE, "Unable to update document"))
		return
	}

	type PageId struct {
		Page int64 `json:"page"`
	}
	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, PageId{Page: pageId}))
}

func deleteDocument(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	ownerId := uuid.MustParse(userId)
	pageId := chi.URLParam(r, "pageId")
	validSpaceUserPermissions := core.ValidateUserPagePermission(pageId, ownerId, "delete")
	if !validSpaceUserPermissions {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to delete document")
		return
	}
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if spaceId == uuid.Nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space ID")
		return
	}
	if !ensureMutableSpace(w, r, spaceId) {
		return
	}
	rowsAffected, err := DeleteDocument(page, spaceId, ownerId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to delete document")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, rowsAffected)
}

func getPageMetadataHandler(w http.ResponseWriter, r *http.Request) {
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
	userId := user.AId
	ownerId := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageIdStr := chi.URLParam(r, "pageId")

	validSpaceUserPermissions := core.ValidateUserPagePermission(pageIdStr, ownerId, "view")
	if !validSpaceUserPermissions {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}

	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to parse page id")
		return
	}

	var metadata PageMetadata
	err = core.GetPool().QueryRow(ctx, getPageMetadata, pageId, spaceId).Scan(&metadata.Id, &metadata.Type, &metadata.SpaceId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Page not found")
			return
		}
		logger().Error(fmt.Sprintf("getPageMetadataHandler: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get page metadata")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, metadata)
}

func getPageInlineLinkMetadataHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	ownerId := uuid.MustParse(user.AId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageIdStr := chi.URLParam(r, "pageId")

	if !core.ValidateUserPagePermission(pageIdStr, ownerId, "view") {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}

	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}

	var metadata PageInlineLinkMetadata
	err = core.GetPool().QueryRow(ctx, getPageInlineLinkMetadata, pageId, spaceId).Scan(
		&metadata.PageId,
		&metadata.Type,
		&metadata.SpaceId,
		&metadata.Title,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Page not found")
			return
		}
		logger().Error(fmt.Sprintf("getPageInlineLinkMetadataHandler: %s", err.Error()))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get page inline link metadata")
		return
	}

	if metadata.Type != "document" {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	if metadata.Title == "" {
		metadata.Title = "Untitled"
	}

	core.SendSuccessResponse(w, r, http.StatusOK, metadata)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)

	// Document endpoints
	r.Get("/space/{spaceId}/page/{pageId}", getDocumentToView)
	r.Get("/space/{spaceId}/page/{pageId}/edit", getDocumentToEdit)
	r.Get("/space/{spaceId}/page/{pageId}/metadata", getPageMetadataHandler)
	r.Get("/space/{spaceId}/page/{pageId}/inline-link", getPageInlineLinkMetadataHandler)
	r.Get("/external-link/metadata", getExternalLinkMetadataHandler)
	r.Delete("/space/{spaceId}/page/{pageId}/delete", deleteDocument)
	r.Post("/space/{spaceId}/page/create", saveDoc)

	// Whiteboard endpoints
	r.Post("/space/{spaceId}/whiteboard/create", createWhiteboard)
	r.Get("/space/{spaceId}/whiteboard/{pageId}", getWhiteboard)
	r.Put("/space/{spaceId}/whiteboard/{pageId}", updateWhiteboard)
	r.Delete("/space/{spaceId}/whiteboard/{pageId}", deleteWhiteboard)

	r.Put("/publish", publishDoc)
	r.Put("/update", updateDraftDoc)
	return r
}
