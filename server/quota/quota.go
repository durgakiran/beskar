package quota

import (
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func getAccountUsageController(w http.ResponseWriter, r *http.Request) {
	userID, err := currentUserID(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	summary, err := GetAccountUsageSummaryForUser(r.Context(), userID)
	if err != nil {
		logger().Error("account quota summary: " + err.Error())
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, summary)
}

func getSpaceUsageController(w http.ResponseWriter, r *http.Request) {
	userID, err := currentUserID(r.Context())
	if err != nil {
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

	summary, err := GetSpaceUsageSummary(r.Context(), spaceID)
	if err != nil {
		logger().Error("space quota summary: " + err.Error())
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, summary)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.Authenticated)
	r.Get("/account", getAccountUsageController)
	r.Get("/space/{spaceId}", getSpaceUsageController)
	return r
}
