package editor

import (
	"errors"
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

func sendFailedReponse(w http.ResponseWriter, r *http.Request, code int, message string) {
	render.Status(r, code)
	render.Render(w, r, core.NewFailedResponse(code, core.FAILURE, message))
}

func sendSuccessResponse(w http.ResponseWriter, r *http.Request, code int, data interface{}) {
	render.Status(r, code)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
}

func getDocumentToView(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid user Id")
		return
	}
	userId := claims.Claims.UserId
	ownerId := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageId := chi.URLParam(r, "pageId")
	validSpaceUserPermissions := ValidateUserSpacePermissions(spaceId, ownerId)
	if !validSpaceUserPermissions {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	outputDocument, err := GetDocument(page, spaceId, ownerId)
	if errors.Is(err, pgx.ErrNoRows) {
		sendSuccessResponse(w, r, http.StatusOK, nil)
		return
	}
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, outputDocument)
}

func getDocumentToEdit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid user Id")
		return
	}
	userId := claims.Claims.UserId
	ownerId := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	pageId := chi.URLParam(r, "pageId")
	validSpaceUserPermissions := ValidateUserSpacePermissions(spaceId, ownerId)
	if !validSpaceUserPermissions {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	outputDocument, err := GetDocumentToEdit(page, spaceId, ownerId)
	if errors.Is(err, pgx.ErrNoRows) {
		sendSuccessResponse(w, r, http.StatusOK, nil)
		return
	}
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, outputDocument)
}

func saveDoc(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid user Id")
		return
	}
	userId := claims.Claims.UserId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		sendFailedReponse(w, r, http.StatusBadRequest, "Unable to read request body")
		return
	}
	inputDoc, err := ValidateNewDoc(data)
	if err != nil {
		sendFailedReponse(w, r, http.StatusBadRequest, "Unable to process request body")
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := ValidateUserSpacePermissions(inputDoc.SpaceId, inputDoc.OwnerId)
	if !validSpaceUserPermissions {
		sendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageId, err := inputDoc.Create()
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, "Unable to create new page")
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
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "Invalid user Id"))
		return
	}
	userId := claims.Claims.UserId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "Unable to read request body"))
		return
	}
	inputDoc, err := ValidateNewDoc(data)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "Unable to process request body"))
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := ValidateUserSpacePermissions(inputDoc.SpaceId, inputDoc.OwnerId)
	if !validSpaceUserPermissions {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "Invalid space permissions"))
		return
	}
	pageId, err := inputDoc.Publish()
	if err != nil && err.Error() == "nothing new to update" {
		render.Status(r, http.StatusConflict)
		render.Render(w, r, core.NewFailedResponse(http.StatusConflict, core.FAILURE, "There is nothing new to update"))
		return
	}
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "Unable to update document"))
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
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "Invalid user Id"))
		return
	}
	userId := claims.Claims.UserId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "Unable to read request body"))
		return
	}
	inputDoc, err := ValidateNewDraftDoc(data)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "Unable to process request body"))
		return
	}
	inputDoc.OwnerId = uuid.MustParse(userId)
	validSpaceUserPermissions := ValidateUserSpacePermissions(inputDoc.SpaceId, inputDoc.OwnerId)
	if !validSpaceUserPermissions {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "Invalid space permissions"))
		return
	}
	pageId, err := inputDoc.Update()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "Unable to update document"))
		return
	}

	type PageId struct {
		Page int64 `json:"page"`
	}
	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, PageId{Page: pageId}))
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Get("/space/{spaceId}/page/{pageId}", getDocumentToView)
	r.Get("/space/{spaceId}/page/{pageId}/edit", getDocumentToEdit)
	r.Post("/save", saveDoc)
	r.Put("/publish", publishDoc)
	r.Put("/update", updateDraftDoc)
	return r
}
