package main

import (
	"log"
	"net/http"

	"github.com/durgakiran/beskar/auth"
	"github.com/durgakiran/beskar/doc"
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

func healthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Charset", "utf-8")
	w.Write([]byte("OK"))
}

func main() {

	const port = "8081"

	r := chi.NewRouter()
	corsMux := middlewareCors(r)

	r.Get("/healthz", http.HandlerFunc(healthz))
	r.Mount("/api/v1/auth", auth.Router())
	r.Mount("/api/v1/doc", doc.Router())

	server := &http.Server{
		Addr:    ":8081",
		Handler: corsMux,
	}

	log.Printf("Serving on port: %s\n", port)
	log.Fatal(server.ListenAndServe())
}
