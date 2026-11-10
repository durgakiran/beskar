package main

import (
	"beskar/desktop/auth"
	"beskar/desktop/config"
	"beskar/desktop/pdfexport"
	"beskar/desktop/platform"
	"beskar/desktop/player"
	"beskar/desktop/transport"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Keep the actual service list testable without starting a GUI or loading a
// user's credentials. The native manager must never enter this binding list.
func desktopServices(manager *auth.Manager, cfg *config.ConfigService, bridge ...*transport.Service) []application.Service {
	nativeTransport := transport.New(cfg.Config, manager.GetAccessToken)
	if len(bridge) > 0 {
		nativeTransport = bridge[0]
	}
	return []application.Service{
		application.NewService(auth.NewUIAuthService(manager)),
		application.NewService(cfg),
		application.NewService(platform.NewNotificationService()),
		application.NewService(&APIProxyService{}),
		application.NewService(&pdfexport.Service{}),
		application.NewService(nativeTransport),
		application.NewService(player.New()),
	}
}
