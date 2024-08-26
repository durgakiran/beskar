package space

import (
	"fmt"
	"io"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

func sendFailedReponse(w http.ResponseWriter, r *http.Request, code int, message string) {
	render.Status(r, code)
	render.Render(w, r, core.NewFailedResponse(int(GetStatus(message)), core.FAILURE, message))
}

func sendSuccessResponse(w http.ResponseWriter, r *http.Request, code int, data interface{}) {
	render.Status(r, code)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
}

func createSpace(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, ErrorCode_name[ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		logger().Error(err.Error())
		sendFailedReponse(w, r, http.StatusBadRequest, ErrorCode_name[ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	ownerId := uuid.MustParse(userId)
	space, err := validateSpace(data)
	if err != nil {
		sendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	space.CreatedBy = ownerId
	fmt.Println(space)
	spaceId, err := createSpaceEntry(space)
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, spaceId)
}

func getSpaces(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, ErrorCode_name[ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	ownerId := uuid.MustParse(userId)
	spaces, err := ListSpaces(ownerId)
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, spaces)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Get("/list", getSpaces)
	r.Post("/create", createSpace)
	return r
}
