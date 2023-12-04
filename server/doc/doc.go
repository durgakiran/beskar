package doc

import (
	"net/http"

	"github.com/durgakiran/beskar/doc/space"
	"github.com/go-chi/chi"
)

func middlewareCors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// set the headers
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func docHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Charset", "utf-8")
	w.Write([]byte("OK"))
}

func Router() http.Handler {
	authRouter := chi.NewRouter()
	authRouter.Mount("/space", space.Router())
	authRouter.Get("/health", docHealth)
	return middlewareCors(authRouter)
}
