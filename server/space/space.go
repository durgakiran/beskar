package space

import (
	"io"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

func currentUser(r *http.Request) (core.UserInfo, uuid.UUID, bool) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		return user, uuid.Nil, false
	}
	userID, err := uuid.Parse(user.AId)
	if err != nil {
		return user, uuid.Nil, false
	}
	return user, userID, true
}

func createSpace(w http.ResponseWriter, r *http.Request) {
	user, ownerID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	_ = user
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	space, err := validateSpace(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	space.CreatedBy = ownerID
	spaceID, err := createSpaceEntry(space)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, spaceID)
}

func getSpaces(w http.ResponseWriter, r *http.Request) {
	_, ownerID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaces, err := ListSpaces(ownerID)
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, 0, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, spaces)
}

func getPageList(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	data, err := getDocumentList(spaceID, userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, data)
}

func listUsers(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	data, err := getSpaceUsers(spaceID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, data)
}

func updateSpace(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if err := ensureSpaceMutable(spaceID); err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		logger().Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	space, err := validateSpace(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	space.Id = spaceID
	err = space.Update()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, space)
}

func getSpaceDetailsController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	space, err := getSpaceDetails(spaceID, userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusNotFound, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, space)
}

func getSpaceSettingsController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	state, err := getSpaceSettingsState(spaceID, userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusNotFound, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, state)
}

func searchMemberCandidatesController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateMemberCandidateSearch(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	result, err := searchMemberCandidates(spaceID, userID, req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func addMembersController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateAddSpaceMembers(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	result, err := addSpaceMembers(spaceID, userID, req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func changeMemberRoleController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateChangeSpaceMemberRole(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	member, err := changeSpaceMemberRole(spaceID, userID, req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, member)
}

func removeMemberController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateRemoveSpaceMember(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	if err := removeSpaceMember(spaceID, userID, req); err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"removed": true})
}

func transferOwnershipController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateTransferOwnership(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	owner, err := transferOwnership(spaceID, userID, req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, owner)
}

func archiveSpaceController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	space, err := archiveSpace(spaceID, userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, space)
}

func unarchiveSpaceController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	space, err := unarchiveSpace(spaceID, userID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, space)
}

func deleteSpaceController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID := uuid.MustParse(chi.URLParam(r, "spaceId"))
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateDeleteSpaceRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	if err := softDeleteSpace(spaceID, userID, req); err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"deleted": true})
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)
	r.Get("/list", getSpaces)
	r.Post("/create", createSpace)
	r.Get("/{spaceId}/page/list", getPageList)
	r.Get("/{spaceId}/users", listUsers)
	r.Get("/{spaceId}/details", getSpaceDetailsController)
	r.Get("/{spaceId}/settings", getSpaceSettingsController)
	r.Post("/{spaceId}/members/candidates/search", searchMemberCandidatesController)
	r.Post("/{spaceId}/members/add", addMembersController)
	r.Put("/{spaceId}/members/role", changeMemberRoleController)
	r.Delete("/{spaceId}/members/remove", removeMemberController)
	r.Post("/{spaceId}/ownership/transfer", transferOwnershipController)
	r.Post("/{spaceId}/archive", archiveSpaceController)
	r.Post("/{spaceId}/unarchive", unarchiveSpaceController)
	r.Post("/{spaceId}/delete", deleteSpaceController)
	r.Put("/{spaceId}", updateSpace)
	return r
}
