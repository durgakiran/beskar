package config

import (
	"fmt"
)

// ConfigService provides methods for the frontend to manage configuration.
type ConfigService struct {
	Config       *AppConfig
	InitialRoute string
}

var (
	DefaultServerURL  = "https://app.durgakiran.com"
	DefaultZitadelURL = "https://id.durgakiran.com"
	DefaultClientID   = "377926419071631362"
)

// NewConfigService creates a new ConfigService, loading the initial config.
func NewConfigService() *ConfigService {
	cfg, err := LoadConfig()
	if err != nil {
		fmt.Printf("Failed to load config, using default: %v\n", err)
		cfg = &AppConfig{}
	}

	// Use injected build-time defaults if not present
	if cfg.ServerURL == "" || cfg.ServerURL == "https://app.durgakiran.com" {
		cfg.ServerURL = DefaultServerURL
	}
	if cfg.ZitadelURL == "" || cfg.ZitadelURL == "https://id.durgakiran.com" {
		cfg.ZitadelURL = DefaultZitadelURL
	}
	if cfg.ClientID == "" || cfg.ClientID == "377926419071631362" {
		cfg.ClientID = DefaultClientID
	}

	// Save to disk to ensure it's persisted
	_ = SaveConfig(cfg)

	return &ConfigService{
		Config: cfg,
	}
}

// GetConfig returns the current configuration.
func (s *ConfigService) GetConfig() *AppConfig {
	return s.Config
}

// GetInitialRoute returns the initial deep link route the app was launched with.
func (s *ConfigService) GetInitialRoute() string {
	route := s.InitialRoute
	s.InitialRoute = "" // Clear it so it's only handled once
	return route
}

// SetInitialRoute sets the initial route.
func (s *ConfigService) SetInitialRoute(route string) {
	s.InitialRoute = route
}
