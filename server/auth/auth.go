package auth

import (
	"context"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

func authenticated(csrf *core.BrowserCSRF, userInfo func(context.Context) (core.UserInfo, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if _, err := userInfo(r.Context()); err == nil {
			var data any
			// This route is also used by desktop and signaling services. Only
			// cookie-authenticated callers receive a browser CSRF token.
			if len(r.Header.Values("Authorization")) == 0 {
				token, ok := csrf.SessionToken(w, r)
				if !ok {
					return
				}
				data = map[string]string{"csrfToken": token}
			}
			render.Status(r, http.StatusOK)
			render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
			return
		}
		render.Status(r, http.StatusUnauthorized)
		render.Render(w, r, core.NewFailedResponse(401, core.FAILURE, core.FAILURE, "Not authenticated"))
	}
}

func Router(csrf *core.BrowserCSRF) *chi.Mux {
	r := chi.NewRouter()
	r.Get("/authenticated", authenticated(csrf, core.GetUserInfo))
	return r
}
