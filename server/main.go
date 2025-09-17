package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	auth "github.com/durgakiran/beskar/auth"
	"github.com/durgakiran/beskar/core"
	editor "github.com/durgakiran/beskar/editor"
	"github.com/durgakiran/beskar/invite"
	media "github.com/durgakiran/beskar/media/controller"
	page "github.com/durgakiran/beskar/page"
	profile "github.com/durgakiran/beskar/profile/controller"
	space "github.com/durgakiran/beskar/space"
	"github.com/durgakiran/beskar/user"
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
			AllowedOrigins: []string{"https://*.durgakiran.com", "http://app.tededox.com", "http://localhost:3000", "http://localhost:8085"},
			// AllowOriginFunc:  func(r *http.Request, origin string) bool { return true },
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: false,
			MaxAge:           300, // Maximum value not ignored by any of major browsers
		}),
	)
}

func CookieLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Log each cookie in the request
		for _, cookie := range r.Cookies() {
			fmt.Println("Cookie Name: %s, Value: %s\n", cookie.Name, cookie.Value)
		}

		// Call the next handler in the chain
		next.ServeHTTP(w, r)
	})
}

func QueryParamLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Log each query parameter in the request
		for key, values := range r.URL.Query() {
			for _, value := range values {
				fmt.Println(fmt.Sprintf("Query Parameter: %s = %s\n", key, value))
			}
		}

		// Call the next handler in the chain
		next.ServeHTTP(w, r)
	})
}

func main() {
	err := godotenv.Load()
	if err != nil {
		logger().Error(err.Error())
	}
	core.InitializeLogger()
	core.InitializeSlogLogger()
	const port = ":9095"

	// create connection pool with database
	connPool := core.GetPool()
	defer connPool.Close()
	connection, err := connPool.Acquire(context.Background())
	if err != nil {
		logger().Error(fmt.Sprintf("Error while acquiring connection from the database pool!!. %s", err.Error()))
		os.Exit(1)
	}
	err = connection.Ping(context.Background())
	if err != nil {
		logger().Error(fmt.Sprintf("Could not ping database %s", err.Error()))
		os.Exit(1)
	}
	connection.Release()

	r := chi.NewRouter()
	addCorsMiddleWare(r)
	mw := core.ZitadelMiddleware()

	r.Use(middleware.Logger)
	r.Use(middleware.Heartbeat("/"))
	r.Use(middleware.Recoverer)
	// r.Use(CookieLogger)
	// r.Use(QueryParamLogger)
	r.Mount("/auth/", core.ZitadelAuthenticator())
	r.Mount("/api/v1", auth.Router())
	r.Mount("/api/v1/media", mw.CheckAuthentication()(media.Router()))
	r.Mount("/api/v1/profile", mw.CheckAuthentication()(profile.Router()))
	r.Mount("/api/v1/editor", mw.CheckAuthentication()(editor.Router()))
	r.Mount("/api/v1/space", mw.CheckAuthentication()(space.Router()))
	r.Mount("/api/v1/invite", mw.CheckAuthentication()(invite.Router()))
	r.Mount("/api/v1/page", mw.CheckAuthentication()(page.Router()))
	r.Mount("/api/v1/user", user.Router())

	logger().Info(fmt.Sprintf("Serving on port: %s", port))
	err = http.ListenAndServe(port, r)
	if err != nil {
		log.Fatal(err)
	}
}
