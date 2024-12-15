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
	emailId := user.Email
	token := r.URL.Query().Get("token")
	if token == "" {
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	// process token
	err = processInvitation(userId, emailId, token, STATUS_ACCEPTED)
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func createInvitation(w http.ResponseWriter, r *http.Request) {
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
		logger().Error(err.Error())
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	invite, err := validateInput(data)
	if err != nil {
		logger().Error(err.Error())
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
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
		core.SendFailedReponse(w, r, 0, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, token)
}

func rejectInvitation(w http.ResponseWriter, r *http.Request) {
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
	token := r.URL.Query().Get("token")
	if token == "" {
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	// process token
	err = processInvitation(userId, user.Email, token, STATUS_REJECTED)
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func removeInvitation(w http.ResponseWriter, r *http.Request) {
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
	userIDUUID := uuid.MustParse(userId)
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		logger().Error(err.Error())
		sendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	invite, err := validateInput(data)
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
		return
	}
	isAllowed := core.ValidateUserSpacePermissions(uuid.MustParse(invite.EntityId), userIDUUID, core.SPACE_INVITE_MEMBER)
	if !isAllowed {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	err = invite.removeInvitation()
	if err != nil {
		sendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	sendSuccessResponse(w, r, http.StatusOK, "")
}

func listSpaceInvites(w http.ResponseWriter, r *http.Request) {
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
	userIDUUID := uuid.MustParse(userId)
	spaceId := uuid.MustParse(chi.URLParam(r, "spaceId"))
	// check permission allowed only for space admin or owner
	isAllowed := core.ValidateUserSpacePermissions(spaceId, userIDUUID, core.SPACE_INVITE_MEMBER)
	if !isAllowed {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	data, err := getSpaceInvites(spaceId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, data)
}

func listUserInvites(w http.ResponseWriter, r *http.Request) {
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
	data, err := getUserInvites(userId, user.Email)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, data)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)
	r.Post("/user/create", createInvitation)
	r.Get("/user/accept", acceptInvitation)
	r.Get("/user/reject", rejectInvitation)
	r.Delete("/user/remove", removeInvitation)
	r.Get("/space/{spaceId}/list", listSpaceInvites)
	r.Get("/user/invites", listUserInvites)
	return r
}
