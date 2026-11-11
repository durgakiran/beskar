//go:build darwin && cgo && beskar_alpha

package auth

import "testing"

func TestAlphaCredentialPolicy(t *testing.T) {
	// Checks signing policy without reading or changing any Keychain item.
	if err := checkNativeSigning(); err != nil {
		t.Fatal("alpha must support ad-hoc signing")
	}
	store := fixtureScope(t, newMemorySecrets())
	if store.service() != "com.durgakiran.beskar.alpha.credentials.v2" || store.context.Environment != "alpha" {
		t.Fatal("alpha credentials must use a separate namespace")
	}
	for _, environment := range []string{"development", "production"} {
		other := store.context
		other.Environment = environment
		if store.valid(credentialSelection{Version: credentialVersion, Context: other, Subject: "test-subject"}) {
			t.Fatal("alpha accepted another environment's credentials")
		}
	}
}
