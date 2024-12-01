package user

import (
	"io"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
)

func searchUser(w http.ResponseWriter, r *http.Request) {
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
	data, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		core.Logger.Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	searchQuery, err := validateInput(data)
	if err != nil {
		core.Logger.Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	users, err := core.SearchUserByEmail(searchQuery.Search, searchQuery.Limit, searchQuery.Offset)
	if err != nil {
		core.Logger.Error(err.Error())
		core.SendFailedReponse(w, r, http.StatusInternalServerError, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, users)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Post("/search", searchUser)
	return r
}
