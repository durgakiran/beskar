package auth

import (
	"fmt"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
)

func authenticated(w http.ResponseWriter, r *http.Request) {
	fmt.Println(authentication.IsAuthenticated(r.Context()))
	if authentication.IsAuthenticated(r.Context()) {
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
	mw := core.ZitadelMiddleware()
	r.Use(mw.CheckAuthentication())
	r.Get("/authenticated", authenticated)
	return r
}
