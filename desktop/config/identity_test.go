package config

import (
	"path/filepath"
	"testing"
)

func TestBuildIdentityAndConfigurationIsolation(t *testing.T) {
	id, environment := "com.durgakiran.beskar", "production"
	if developmentBuild {
		id, environment = "com.durgakiran.beskar.dev", "development"
	}
	if alphaBuild {
		id, environment = "com.durgakiran.beskar.alpha", "alpha"
	}
	if ApplicationID != id || Environment != environment {
		t.Fatal("unexpected build identity")
	}
	root := t.TempDir()
	path, err := configPath(root)
	if err != nil || path != filepath.Join(root, "Beskar", environment, "config.json") {
		t.Fatal("configuration is not environment scoped")
	}
}
