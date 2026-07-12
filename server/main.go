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
	"github.com/durgakiran/beskar/docversioncleanup"
	editor "github.com/durgakiran/beskar/editor"
	"github.com/durgakiran/beskar/editor/pageevents"
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
	"github.com/go-chi/render"
	"github.com/joho/godotenv"
	zoidc "github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	openid "github.com/zitadel/zitadel-go/v3/pkg/authentication/oidc"
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

	pageevents.SetLogger(core.Logger)
	pageevents.Init(context.Background())

	notificationConfig := notification.LoadConfig()
	quotaConfig := quota.LoadConfig()
	assetCleanupConfig := assetcleanup.LoadConfig()
	documentVersionCleanupConfig := docversioncleanup.LoadConfig()
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
	documentVersionCleanupWorker := docversioncleanup.NewWorker(documentVersionCleanupConfig)
	if documentVersionCleanupConfig.Enabled {
		go documentVersionCleanupWorker.Start(context.Background())
	}

	r := chi.NewRouter()
	addCorsMiddleWare(r)
	mw := core.ZitadelMiddleware()

	// authChain attempts to authenticate via Bearer token if present, otherwise falls back to Cookie session
	authChain := func(mw *authentication.Interceptor[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]]) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			cookiePath := mw.CheckAuthentication()(next)
			bearerPath := core.AuthMiddleWare(next)
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				token := r.Header.Get("Authorization")
				if token == "" {
					// Fallback to query parameter for assets like images
					queryToken := r.URL.Query().Get("token")
					if queryToken != "" {
						token = "Bearer " + queryToken
						r.Header.Set("Authorization", token)
						logger().Info(fmt.Sprintf("authChain: Extracted token from query param for %s", r.URL.Path))
					}
				}
				if strings.HasPrefix(strings.ToLower(token), "bearer ") {
					logger().Info(fmt.Sprintf("authChain: Using Bearer path for %s", r.URL.Path))
					bearerPath.ServeHTTP(w, r)
					return
				}
				logger().Info(fmt.Sprintf("authChain: Using Cookie path for %s", r.URL.Path))
				cookiePath.ServeHTTP(w, r)
			})
		}
	}

	if requestLoggingEnabled() {
		r.Use(middleware.Logger)
	}
	r.Use(middleware.Heartbeat("/"))
	r.Use(middleware.Recoverer)
	// r.Use(CookieLogger)
	// r.Use(QueryParamLogger)

	// Desktop App Auto-Discovery Endpoint
	r.Get("/.well-known/beskar", func(w http.ResponseWriter, req *http.Request) {
		render.JSON(w, req, map[string]string{
			"zitadel_url": core.IssuerBaseURL(),
		})
	})

	r.Mount("/auth/", core.ZitadelAuthRouter())
	r.Mount("/api/v1", authChain(mw)(auth.Router()))
	r.Mount("/api/v1/media", authChain(mw)(media.Router()))
	r.Mount("/api/v1/attachments", authChain(mw)(attachment.Router()))
	r.Mount("/api/v1/profile", authChain(mw)(profile.Router()))
	r.Mount("/api/v1/quota", authChain(mw)(quota.Router()))
	r.Mount("/api/v1/editor", authChain(mw)(editor.Router()))
	r.Mount("/api/v1/space", authChain(mw)(space.Router()))
	r.Mount("/api/v1/invite", authChain(mw)(invite.Router()))
	r.Mount("/api/v1/page", authChain(mw)(page.Router()))
	r.Mount("/api/v1/comment", authChain(mw)(comment.Router()))
	r.Mount("/api/v1/notifications", authChain(mw)(notification.NewController().Router()))
	r.Mount("/api/v1/user", user.Router())
	if notificationConfig.AdminEnabled && notificationConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/email", authChain(mw)(notification.NewAdminController(notificationConfig).Router()))
	}
	if quotaConfig.AdminEnabled && quotaConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/quota", authChain(mw)(quota.NewAdminController(quotaConfig).Router()))
	}
	if assetCleanupConfig.AdminEnabled && assetCleanupConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/asset-cleanup", authChain(mw)(assetcleanup.NewAdminController(assetCleanupConfig, assetCleanupWorker).Router()))
	}
	if documentVersionCleanupConfig.AdminEnabled && documentVersionCleanupConfig.AdminToken != "" {
		r.Mount("/api/v1/admin/document-versions/cleanup", authChain(mw)(docversioncleanup.NewAdminController(documentVersionCleanupConfig, documentVersionCleanupWorker).Router()))
	}

	logger().Info(fmt.Sprintf("Serving on port: %s", port))
	err = http.ListenAndServe(port, r)
	if err != nil {
		log.Fatal(err)
	}
}
