package invite

import (
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
	status, statusCode := core.GetStatus(message)
	if code == http.StatusInternalServerError {
		code = statusCode
	}
	render.Status(r, code)
	render.Render(w, r, core.NewFailedResponse(int(status), core.FAILURE, core.FAILURE, message))
}

func sendSuccessResponse(w http.ResponseWriter, r *http.Request, code int, data interface{}) {
	render.Status(r, code)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
}

func acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	token := r.URL.Query().Get("token")
	if token == "" {
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	// process token
	err := processInvitation(userId, token, STATUS_ACCEPTED)
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func createInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		logger().Error(err.Error())
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	invite, err := validateInput(data)
	if invite.UserId == uuid.Nil {
		logger().Error("Invalid user id")
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if invite.EntityId == "" {
		logger().Error("Invalid entity id")
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	invite.SenderId = uuid.MustParse(userId)
	// validate sender permissions
	isAllowed := core.ValidateUserEntityPermission(invite.Entity, invite.EntityId, invite.SenderId, core.SPACE_INVITE_MEMBER)
	if !isAllowed {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	token, err := invite.invite()
	if err != nil {
		sendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, token)
}

func rejectInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	token := r.URL.Query().Get("token")
	if token == "" {
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	// process token
	err := processInvitation(userId, token, STATUS_REJECTED)
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func removeInvitation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims, ok := ctx.Value("claims").(core.Claims)
	if !ok {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	userId := claims.Claims.UserId
	token := r.URL.Query().Get("token")
	if token == "" {
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	// process token
	err := processInvitation(userId, token, STATUS_REMOVED)
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Post("/user/create", createInvitation)
	r.Get("/user/accept", acceptInvitation)
	r.Get("/user/reject", rejectInvitation)
	r.Get("/user/remove", removeInvitation)
	return r
}
