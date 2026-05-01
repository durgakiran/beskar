package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/durgakiran/beskar/assetcleanup"
	attachment "github.com/durgakiran/beskar/attachment/controller"
	auth "github.com/durgakiran/beskar/auth"
	"github.com/durgakiran/beskar/comment"
	"github.com/durgakiran/beskar/core"
	editor "github.com/durgakiran/beskar/editor"
	"github.com/durgakiran/beskar/invite"
	media "github.com/durgakiran/beskar/media/controller"
	"github.com/durgakiran/beskar/notification"
	page "github.com/durgakiran/beskar/page"
	profile "github.com/durgakiran/beskar/profile/controller"
	"github.com/durgakiran/beskar/quota"
	space "github.com/durgakiran/beskar/space"
	blobstorage "github.com/durgakiran/beskar/storage"
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

func requestLoggingEnabled() bool {
	value := strings.TrimSpace(os.Getenv("HTTP_REQUEST_LOGGING_ENABLED"))
	if value == "" {
		return true
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return true
	}
	return enabled
}

func addCorsMiddleWare(r *chi.Mux) {
	r.Use(cors.Handler(
		cors.Options{
			AllowedOrigins: core.AllowedOriginsFromEnv(),
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
			fmt.Printf("Cookie Name: %s, Value: %s\n", cookie.Name, cookie.Value)
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
				fmt.Printf("Query Parameter: %s = %s\n", key, value)
			}
		}

		// Call the next handler in the chain
		next.ServeHTTP(w, r)
	})
}

func main() {
	core.InitializeLogger()
	core.InitializeSlogLogger()
	const port = ":9095"
	err := godotenv.Load()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		logger().Error(err.Error())
	}

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

	if _, err := blobstorage.RuntimeStore(context.Background()); err != nil {
		logger().Error(fmt.Sprintf("Could not initialize runtime storage %s", err.Error()))
		os.Exit(1)
	}

	notificationConfig := notification.LoadConfig()
	quotaConfig := quota.LoadConfig()
	assetCleanupConfig := assetcleanup.LoadConfig()
	if notificationConfig.WorkerEnabled {
		go notification.NewWorker(notificationConfig).Start(context.Background())
	}
	if quotaConfig.ReconciliationEnabled {
		go quota.NewReconciler(quotaConfig).Start(context.Background())
	}
	assetCleanupWorker := assetcleanup.NewWorker(assetCleanupConfig)
	if assetCleanupConfig.Enabled {
		go assetCleanupWorker.Start(context.Background())
	}

	r := chi.NewRouter()
	addCorsMiddleWare(r)
	mw := core.ZitadelMiddleware()

	if requestLoggingEnabled() {
		r.Use(middleware.Logger)
	}
	r.Use(middleware.Heartbeat("/"))
	r.Use(middleware.Recoverer)
	// r.Use(CookieLogger)
	// r.Use(QueryParamLogger)
	r.Mount("/auth/", core.ZitadelAuthRouter())
	r.Mount("/api/v1", auth.Router())
	r.Mount("/api/v1/media", mw.CheckAuthentication()(media.Router()))
	r.Mount("/api/v1/attachments", mw.CheckAuthentication()(attachment.Router()))
	r.Mount("/api/v1/profile", mw.CheckAuthentication()(profile.Router()))
	r.Mount("/api/v1/quota", mw.CheckAuthentication()(quota.Router()))
	r.Mount("/api/v1/editor", mw.CheckAuthentication()(editor.Router()))
	r.Mount("/api/v1/space", mw.CheckAuthentication()(space.Router()))
	r.Mount("/api/v1/invite", mw.CheckAuthentication()(invite.Router()))
	r.Mount("/api/v1/page", mw.CheckAuthentication()(page.Router()))
	r.Mount("/api/v1/comment", mw.CheckAuthentication()(comment.Router()))
	r.Mount("/api/v1/user", user.Router())
	if notificationConfig.AdminEnabled && notificationConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/email", mw.CheckAuthentication()(notification.NewAdminController(notificationConfig).Router()))
	}
	if quotaConfig.AdminEnabled && quotaConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/quota", mw.CheckAuthentication()(quota.NewAdminController(quotaConfig).Router()))
	}
	if assetCleanupConfig.AdminEnabled && assetCleanupConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/asset-cleanup", mw.CheckAuthentication()(assetcleanup.NewAdminController(assetCleanupConfig, assetCleanupWorker).Router()))
	}

	logger().Info(fmt.Sprintf("Serving on port: %s", port))
	err = http.ListenAndServe(port, r)
	if err != nil {
		log.Fatal(err)
	}
}
