package editor

import (
	"encoding/json"
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
	outputDocument, err := GetDocument(page, spaceId, ownerId)
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

func createComment(w http.ResponseWriter, r *http.Request) {
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
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	var request CreateCommentRequest
	if err := json.Unmarshal(data, &request); err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid request body")
		return
	}

	comment, err := CreateComment(spaceId, pageId, ownerId, request)
	if err != nil {
		logger().Error(fmt.Sprintf("Error creating comment: %v", err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}

	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, comment))
}

func getComments(w http.ResponseWriter, r *http.Request) {
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
	pageIdStr := chi.URLParam(r, "pageId")
	pageId, err := strconv.ParseInt(pageIdStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page ID")
		return
	}

	var docId *int64
	if docIdStr := r.URL.Query().Get("doc_id"); docIdStr != "" {
		parsedDocId, err := strconv.ParseInt(docIdStr, 10, 64)
		if err == nil {
			docId = &parsedDocId
		}
	}

	includeDraft := r.URL.Query().Get("include_draft") == "true"
	comments, err := GetComments(pageId, docId, includeDraft, userId)
	if err != nil {
		logger().Error(fmt.Sprintf("Error fetching comments: %v", err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to fetch comments")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, comments)
}

func updateComment(w http.ResponseWriter, r *http.Request) {
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
	commentIdStr := chi.URLParam(r, "commentId")
	commentId, err := uuid.Parse(commentIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid comment ID")
		return
	}

	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	var request UpdateCommentRequest
	if err := json.Unmarshal(data, &request); err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := UpdateComment(commentId, userId, request.CommentText); err != nil {
		logger().Error(fmt.Sprintf("Error updating comment: %v", err))
		if err.Error() == "only comment author can edit comment" {
			core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// Fetch updated comment
	comment, err := GetCommentById(commentId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to fetch updated comment")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, comment)
}

func deleteComment(w http.ResponseWriter, r *http.Request) {
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
	commentIdStr := chi.URLParam(r, "commentId")
	commentId, err := uuid.Parse(commentIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid comment ID")
		return
	}

	// Get comment to check page owner
	comment, err := GetCommentById(commentId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusNotFound, "Comment not found")
		return
	}

	// Get page owner
	connPool := core.GetPool()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to process request")
		return
	}
	defer conn.Release()

	var pageOwnerId uuid.UUID
	err = conn.QueryRow(ctx, "SELECT owner_id FROM core.page WHERE id = $1", comment.PageId).Scan(&pageOwnerId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to process request")
		return
	}

	if err := DeleteComment(commentId, userId, pageOwnerId); err != nil {
		logger().Error(fmt.Sprintf("Error deleting comment: %v", err))
		if err.Error() == "only comment author or page owner can delete comment" {
			core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, map[string]string{"message": "Comment deleted successfully"})
}

func resolveComment(w http.ResponseWriter, r *http.Request) {
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
	commentIdStr := chi.URLParam(r, "commentId")
	commentId, err := uuid.Parse(commentIdStr)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid comment ID")
		return
	}

	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}

	var request ResolveCommentRequest
	if err := json.Unmarshal(data, &request); err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := ResolveComment(commentId, userId, request.Resolved); err != nil {
		logger().Error(fmt.Sprintf("Error resolving comment: %v", err))
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}

	// Fetch updated comment
	comment, err := GetCommentById(commentId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to fetch updated comment")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, comment)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)
	r.Get("/space/{spaceId}/page/{pageId}", getDocumentToView)
	r.Get("/space/{spaceId}/page/{pageId}/edit", getDocumentToEdit)
	r.Post("/space/{spaceId}/page/create", saveDoc)
	r.Put("/publish", publishDoc)
	r.Put("/update", updateDraftDoc)

	// Comment routes
	r.Post("/space/{spaceId}/page/{pageId}/comments", createComment)
	r.Get("/space/{spaceId}/page/{pageId}/comments", getComments)
	r.Put("/space/{spaceId}/page/{pageId}/comments/{commentId}", updateComment)
	r.Delete("/space/{spaceId}/page/{pageId}/comments/{commentId}", deleteComment)
	r.Put("/space/{spaceId}/page/{pageId}/comments/{commentId}/resolve", resolveComment)

	return r
}
