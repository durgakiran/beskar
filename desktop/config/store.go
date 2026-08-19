package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppConfig represents the persistent configuration for the desktop app.
type AppConfig struct {
	ServerURL  string `json:"server_url"`
	ZitadelURL string `json:"zitadel_url"`
	ClientID   string `json:"client_id"`
}

// getConfigPath returns the path to the config.json file in the user's config directory.
func getConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(configDir, "Beskar")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(appDir, "config.json"), nil
}

// LoadConfig reads the configuration from disk.
// If the file does not exist, it returns an empty configuration without an error.
func LoadConfig() (*AppConfig, error) {
	path, err := getConfigPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &AppConfig{}, nil
		}
		return nil, err
	}

	var config AppConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// SaveConfig writes the configuration to disk.
func SaveConfig(config *AppConfig) error {
	path, err := getConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}
