package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/durgakiran/beskar/core"
	editor "github.com/durgakiran/beskar/editor"
	media "github.com/durgakiran/beskar/media/controller"
	profile "github.com/durgakiran/beskar/profile/controller"
	space "github.com/durgakiran/beskar/space"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

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
		logger().Error(err.Error())
	}
	core.InitializeLogger()
	logger := core.Logger
	const port = ":9095"

	// create connection pool with database
	connPool := core.GetPool()
	defer connPool.Close()
	connection, err := connPool.Acquire(context.Background())
	if err != nil {
		logger.Error(fmt.Sprintf("Error while acquiring connection from the database pool!!. %s", err.Error()))
		os.Exit(1)
	}
	err = connection.Ping(context.Background())
	if err != nil {
		logger.Error(fmt.Sprintf("Could not ping database %s", err.Error()))
		os.Exit(1)
	}
	connection.Release()

	r := chi.NewRouter()
	addCorsMiddleWare(r)

	r.Use(middleware.Logger)
	r.Use(middleware.Heartbeat("/"))
	r.Use(middleware.Recoverer)
	r.Mount("/media", media.Router())
	r.Mount("/profile", profile.Router())
	r.Mount("/editor", editor.Router())
	r.Mount("/space", space.Router())

	logger.Info(fmt.Sprintf("Serving on port: %s", port))
	err = http.ListenAndServe(port, r)
	if err != nil {
		log.Fatal(err)
	}
}
