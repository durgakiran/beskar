package auth

import (
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

func authenticated(w http.ResponseWriter, r *http.Request) {
	if _, err := core.GetUserInfo(r.Context()); err == nil {
		render.Status(r, http.StatusOK)
		render.Render(w, r, core.NewSucessResponse(core.SUCCESS, nil))
		return
	}
	render.Status(r, http.StatusUnauthorized)
	render.Render(w, r, core.NewFailedResponse(401, core.FAILURE, core.FAILURE, "Not authenticated"))
	return
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/authenticated", authenticated)
	return r
}
