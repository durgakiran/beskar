//go:build darwin && cgo && !beskar_dev

package auth

import (
	"beskar/desktop/config"
	"testing"
)

func TestProductionCredentialAccessRequiresSigningConfiguration(t *testing.T) {
	if config.ReleaseTeamID != "" {
		t.Skip("release-signing configuration supplied externally")
	}
	// This fails before any Keychain operation and never reads credentials.
	if checkNativeSigning() != errCredentialAppIdentity {
		t.Fatal("unconfigured production app allowed credential access")
	}
}
