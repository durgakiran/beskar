package main

import (
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	media "github.com/durgakiran/beskar/media/controller"
	profile "github.com/durgakiran/beskar/profile/controller"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
)

func addCorsMiddleWare(r *chi.Mux) {
	r.Use(cors.Handler(
		cors.Options{
			AllowedOrigins: []string{"https://*", "http://localhost:3000"},
			// AllowOriginFunc:  func(r *http.Request, origin string) bool { return true },
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: false,
			MaxAge:           300, // Maximum value not ignored by any of major browsers
		}),
	)
}

func main() {
	err := godotenv.Load()
	if err != nil {
		fmt.Println(err)
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	const port = ":9095"

	r := chi.NewRouter()
	addCorsMiddleWare(r)

	r.Use(middleware.Logger)
	r.Use(middleware.Heartbeat("/"))
	r.Use(middleware.Recoverer)
	r.Mount("/media", media.Router())
	r.Mount("/profile", profile.Router())

	logger.Error("Serving on port: %s\n", port)
	err = http.ListenAndServe(port, r)
	if err != nil {
		log.Fatal(err)
	}
}
