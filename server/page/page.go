package page

import (
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
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
	breadCrumbs, err := getPageBreadCrumbs(page)
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
