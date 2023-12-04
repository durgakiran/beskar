// This simple package to deal with document space
package space

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/durgakiran/beskar/db"
	"github.com/go-chi/chi"
)

func docHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Charset", "utf-8")
	w.Write([]byte("OK"))
}

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

// **Create space.**
// Creates a new space, requires name of the space in body.
// Allows duplicate space names.
func create(w http.ResponseWriter, r *http.Request) {
	var body Space
	err := json.NewDecoder(r.Body).Decode(&body)

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	connPool := db.GetCoreDBConn()

	tag, err := connPool.Exec(context.Background(), INSERT_INTO_SPACE, body.Name)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	fmt.Print(tag)
	if tag.Insert() {
		fmt.Print("Data inserted")
		w.WriteHeader(http.StatusCreated)
		return
	}

	w.WriteHeader(http.StatusInternalServerError)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Charset", "utf-8")
	w.Write([]byte("Unable to create space"))

}

func Router() http.Handler {
	authRouter := chi.NewRouter()
	authRouter.Get("/health", docHealth)
	authRouter.Post("/", create)
	return middlewareCors(authRouter)
}
