package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"runtime"
	"strings"

	"beskar/desktop/auth"
	"beskar/desktop/config"
	"beskar/desktop/security"
	"beskar/desktop/transport"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:ui/dist
var embeddedAssets embed.FS

//go:embed assets/teddox.png
var applicationIcon []byte

// APIProxyService is a placeholder for the API proxy service to be implemented later.
type APIProxyService struct{}

// ProxyMiddleware forwards API and collaboration requests to the configured backend with the auth token.
func ProxyMiddleware(authService *auth.Manager, cfg *config.AppConfig) application.Middleware {
	return func(next http.Handler) http.Handler {
		targetStr := cfg.ServerURL
		if targetStr == "" {
			// Fallback if config is missing (e.g. during onboarding)
			targetStr = config.DefaultServerURL
		}
		targetURL, err := url.Parse(targetStr)
		if err != nil {
			log.Fatal("Invalid USER_SERVER_URL for proxy:", err)
		}

		proxy := httputil.NewSingleHostReverseProxy(targetURL)
		proxy.Transport = config.NewHTTPTransport()

		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.Host = targetURL.Host

			// Inject the access token if available
			token := authService.GetAccessToken()
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
				log.Printf("[Wails Proxy] Intercepting %s: Injected token (len=%d)", req.URL.Path, len(token))
			} else {
				log.Printf("[Wails Proxy] Intercepting %s: NO TOKEN AVAILABLE", req.URL.Path)
			}
		}

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1" || strings.HasPrefix(r.URL.Path, "/api/v1/") ||
				strings.HasPrefix(r.URL.Path, "/ws") ||
				strings.HasPrefix(r.URL.Path, "/collab") {
				proxy.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func main() {
	// Ensure WebAssembly files are served with the correct MIME type
	// This is critical because Windows often lacks the .wasm registry association.
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".js", "application/javascript")

	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()
	configService := config.NewConfigService()
	authService := &auth.Manager{}
	nativeTransport := transport.New(configService.Config, authService.GetAccessToken)

	// Check if started with a deep link
	for _, arg := range os.Args {
		if strings.HasPrefix(arg, "teddox://") {
			if !strings.HasPrefix(arg, "teddox://callback") {
				configService.SetInitialRoute(arg)
			}
		}
	}

	assets, err := fs.Sub(embeddedAssets, "ui/dist")
	if err != nil {
		log.Fatalf("Failed to load embedded assets: %v", err)
	}

	app := application.New(application.Options{
		Name:       config.ApplicationName,
		Icon:       applicationIcon,
		OnShutdown: cancelApp,
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: securityMiddleware(nativeTransport, ProxyMiddleware(authService, configService.Config)),
		},
		Services: desktopServices(authService, configService, nativeTransport),

		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: config.ApplicationID,
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if app := application.Get(); app != nil {
					application.InvokeSync(app.Show)
					if windows := app.Window.GetAll(); len(windows) > 0 {
						windows[0].Show()
						windows[0].Focus()
					}
					// Windows/Linux and macOS second-instance relays pass URLs as args.
					for _, arg := range data.Args {
						handleDeepLink(arg, authService.HandleCallback, func(route string) {
							app.Event.Emit("deep-link-opened", route)
						})
					}
				}
			},
		},
	})

	// macOS delivers URLs to a running app as native events, without argv.
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(e *application.ApplicationEvent) {
		handleDeepLink(e.Context().URL(), func(raw string) {
			log.Print("Received native desktop login callback")
			authService.HandleCallback(raw)
		}, func(route string) {
			app.Event.Emit("deep-link-opened", route)
		})
		application.InvokeSync(app.Show)
		if windows := app.Window.GetAll(); len(windows) > 0 {
			windows[0].Show()
			windows[0].Focus()
		}
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:          config.ApplicationName,
		URL:            "/index.desktop.html",
		EnableFileDrop: true,
	})

	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		if runtime.GOOS == "darwin" {
			application.InvokeSync(func() {
				if !security.InstallNavigationGuard(window.NativeWindow()) {
					log.Print("Unable to enforce native navigation policy; closing application")
					app.Quit()
				}
			})
		}
	})

	systemTray := app.SystemTray.New()
	trayMenu := app.NewMenu()
	trayMenu.Add("Open Teddox").OnClick(func(ctx *application.Context) {
		application.InvokeSync(app.Show)
		if windows := app.Window.GetAll(); len(windows) > 0 {
			windows[0].Show()
			windows[0].Focus()
		}
	})
	trayMenu.AddSeparator()
	trayMenu.Add("Logout").OnClick(func(ctx *application.Context) {
		authService.Logout()
	})
	trayMenu.Add("Quit").OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	systemTray.SetMenu(trayMenu)

	authService.Initialize(appCtx, configService.Config)

	err = app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
