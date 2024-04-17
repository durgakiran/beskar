package profile

import (
	"net/http"
	"strings"

	"github.com/durgakiran/beskar/core"
	profile "github.com/durgakiran/beskar/profile/service"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

func getProfileData(w http.ResponseWriter, r *http.Request) {
	data, err := profile.GetProfileData(strings.Split(r.Header.Get("Authorization"), " ")[1])
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, err.Error(), ""))
	}
	render.Status(r, http.StatusOK)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Get("/details", getProfileData)
	return r
}
