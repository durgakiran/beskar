// Package apidocs serves the embedded API specification and Scalar console.
package apidocs

import (
	_ "embed"
	"net/http"

	"github.com/go-chi/chi/v5"
)

//go:embed openapi.json
var specification []byte

//go:embed index.html
var page []byte

// Register keeps documentation public so users can discover how to sign in.
// API requests still pass through their existing authentication middleware.
func Register(r chi.Router) {
	r.Get("/api/docs", servePage)
	r.Get("/api/docs/", servePage)
	r.Get("/api/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(specification)
	})
}

func servePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(page)
}
