package space

import (
	"errors"
	"io"
	"net/http"
	"strconv"

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

func movePageController(w http.ResponseWriter, r *http.Request) {
	_, actor, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	pageID, idErr := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || idErr != nil || pageID <= 0 || pageID > 9007199254740991 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page or space")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid move request")
		return
	}
	req, err := validateMovePageRequest(data)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Provide parentId (positive or null) and, optionally, targetPageId with placement before or after")
		return
	}
	parent := req.ParentId
	if (parent != nil && *parent == pageID) || (req.TargetPageId != nil && *req.TargetPageId == pageID) {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "A page cannot contain itself")
		return
	}
	if !core.ValidateUserSpacePermissions(spaceID, actor, core.SPACE_VIEW) ||
		!core.ValidateUserPagePermission(strconv.FormatInt(pageID, 10), actor, core.PAGE_EDIT) ||
		(parent != nil && !core.ValidateUserPagePermission(strconv.FormatInt(*parent, 10), actor, core.PAGE_EDIT)) ||
		(parent == nil && !core.ValidateUserSpacePermissions(spaceID, actor, core.SPACE_EDIT_PAGE)) ||
		(req.TargetPageId != nil && !core.ValidateUserPagePermission(strconv.FormatInt(*req.TargetPageId, 10), actor, core.PAGE_EDIT)) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "You do not have permission to move this page to that location")
		return
	}
	err = movePage(r.Context(), spaceID, pageID, req)
	if err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, errMovePageNotFound), errors.Is(err, errMoveSpaceNotFound):
			status = http.StatusNotFound
		case errors.Is(err, errMoveSpaceReadOnly):
			status = http.StatusForbidden
		case errors.Is(err, errPageChangeConflict), errors.Is(err, errPageRankExhausted), errors.Is(err, errPageOrderSiblings):
			status = http.StatusConflict
		case errors.Is(err, errMovePageDestination), errors.Is(err, errMovePageCycle):
			status = http.StatusBadRequest
		}
		core.SendFailedReponse(w, r, status, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, MovePageResponse{PageId: pageID, ParentId: parent})
}

func reorderPageController(w http.ResponseWriter, r *http.Request) {
	_, actor, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	pageID, idErr := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || idErr != nil || pageID <= 0 || pageID > 9007199254740991 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	defer r.Body.Close()
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	req, err := validateReorderPageRequest(data)
	if err != nil || req.TargetPageId == pageID {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Choose a different sibling and a placement of before or after")
		return
	}
	if !core.ValidateUserSpacePermissions(spaceID, actor, core.SPACE_EDIT_PAGE) ||
		!core.ValidateUserPagePermission(strconv.FormatInt(pageID, 10), actor, core.PAGE_EDIT) ||
		!core.ValidateUserPagePermission(strconv.FormatInt(req.TargetPageId, 10), actor, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}
	if err := reorderPage(r.Context(), spaceID, pageID, req); err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, errMoveSpaceNotFound), errors.Is(err, errMovePageNotFound):
			status = http.StatusNotFound
		case errors.Is(err, errMoveSpaceReadOnly):
			status = http.StatusForbidden
		case errors.Is(err, errPageOrderSiblings), errors.Is(err, errPageChangeConflict), errors.Is(err, errPageRankExhausted):
			status = http.StatusConflict
		}
		core.SendFailedReponse(w, r, status, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]bool{"reordered": true})
}

func getPageDescendantsController(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	pageID, err := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || pageID <= 0 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}

	data, err := getPageDescendants(spaceID, userID, pageID)
	if err != nil {
		if err.Error() == core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA] {
			core.SendFailedReponse(w, r, http.StatusNotFound, err.Error())
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
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
	renderDisabledOwnershipTransfer(w, r)
}

func renderDisabledOwnershipTransfer(w http.ResponseWriter, r *http.Request) {
	core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
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
	r.Put("/{spaceId}/page/{pageId}/parent", movePageController)
	r.Put("/{spaceId}/page/{pageId}/order", reorderPageController)
	r.Get("/{spaceId}/page/{pageId}/descendants", getPageDescendantsController)
	r.Get("/{spaceId}/users", listUsers)
	registerMentionRoutes(r)
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
