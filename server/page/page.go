package page

import (
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func getBreadCrumbs(w http.ResponseWriter, r *http.Request) {
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
	pageId := chi.URLParam(r, "pageId")
	page, err := strconv.ParseInt(pageId, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get document")
		return
	}
	actor, err := uuid.Parse(user.AId)
	if err != nil || !core.ValidateUserPagePermission(pageId, actor, "view") {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid page permissions")
		return
	}
	editable, err := core.GetEntitiesWithPermission("page", "user", actor.String(), core.PAGE_EDIT)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to get permissions")
		return
	}
	breadCrumbs, err := getPageBreadCrumbs(page, editable)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, breadCrumbs)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/{pageId}/breadCrumbs", getBreadCrumbs)
	return r
}
