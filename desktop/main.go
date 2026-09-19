package main

import (
	"context"
	"crypto/tls"
	"embed"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"beskar/desktop/auth"
	"beskar/desktop/config"
	"beskar/desktop/platform"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:ui/dist
var embeddedAssets embed.FS

// APIProxyService is a placeholder for the API proxy service to be implemented later.
type APIProxyService struct{}

// ProxyMiddleware intercepts requests to /api/v1/media/ and proxies them to the backend with the auth token.
func ProxyMiddleware(authService *auth.AuthService, cfg *config.AppConfig) application.Middleware {
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
		proxy.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
		
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
			if strings.HasPrefix(r.URL.Path, "/api/v1/media/") || 
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

	configService := config.NewConfigService()
	authService := &auth.AuthService{}

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
		Name: "Teddox",
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: ProxyMiddleware(authService, configService.Config),
		},
		Services: []application.Service{
			application.NewService(authService),
			application.NewService(configService),
			application.NewService(platform.NewNotificationService()),
			application.NewService(&APIProxyService{}),
		},
		Windows: application.WindowsOptions{
			AdditionalBrowserArgs: []string{"--ignore-certificate-errors", "--disable-web-security"},
		},

		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.durgakiran.beskar",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				log.Printf("Second instance launched with args: %v", data.Args)
				if app := application.Get(); app != nil {
					app.Show()
					if windows := app.Window.GetAll(); len(windows) > 0 {
						windows[0].Show()
						windows[0].Focus()
					}
					// Handle deep link passed as arg on Windows
					for _, arg := range data.Args {
						if strings.HasPrefix(arg, "teddox://") {
							if strings.HasPrefix(arg, "teddox://callback") {
								authService.HandleCallback(arg)
							} else {
								app.Event.Emit("deep-link-opened", arg)
							}
						}
					}
				}
			},
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:          "Teddox",
		URL:            "/index.desktop.html",
		EnableFileDrop: true,
	})

	systemTray := app.SystemTray.New()
	trayMenu := app.NewMenu()
	trayMenu.Add("Open Teddox").OnClick(func(ctx *application.Context) {
		app.Show()
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

	authService.Initialize(context.Background(), configService.Config)

	err = app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
