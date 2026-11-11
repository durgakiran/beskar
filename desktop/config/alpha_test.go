//go:build beskar_alpha

package config

import "testing"

const alphaBuild = true

func TestAlphaIdentity(t *testing.T) {
	if ApplicationName != "Teddox Alpha" || ApplicationID != "com.durgakiran.beskar.alpha" || Environment != "alpha" {
		t.Fatal("alpha must have its own application identity")
	}
}

func TestAlphaReplacesPersistedDevelopmentConfiguration(t *testing.T) {
	cfg := &AppConfig{ServerURL: "https://app.durgakiran.com", ZitadelURL: "https://id.durgakiran.com", ClientID: "development-client"}
	applyBuildDefaults(cfg)
	if cfg.ServerURL != DefaultServerURL || cfg.ZitadelURL != DefaultZitadelURL || cfg.ClientID != DefaultClientID {
		t.Fatal("alpha retained stale configuration instead of release endpoints/client")
	}
}
