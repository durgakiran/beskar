package main

import (
	"beskar/desktop/auth"
	"beskar/desktop/config"
	"beskar/desktop/pdfexport"
	"beskar/desktop/platform"
	"beskar/desktop/transport"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Keep the actual service list testable without starting a GUI or loading a
// user's credentials. The native manager must never enter this binding list.
func desktopServices(manager *auth.Manager, cfg *config.ConfigService) []application.Service {
	return []application.Service{
		application.NewService(auth.NewUIAuthService(manager)),
		application.NewService(cfg),
		application.NewService(platform.NewNotificationService()),
		application.NewService(&APIProxyService{}),
		application.NewService(&pdfexport.Service{}),
		application.NewService(transport.New(cfg.Config, manager.GetAccessToken)),
	}
}
