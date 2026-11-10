//go:build darwin && cgo && (beskar_dev || beskar_alpha)

package auth

import (
	"beskar/desktop/config"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
)

// Explicit integration opt-in: only creates/deletes a randomly named synthetic
// item. Never reads or deletes a user's application or legacy credential entry.
func TestNativeKeychainSyntheticRoundTrip(t *testing.T) {
	if os.Getenv("BESKAR_TEST_NATIVE_KEYCHAIN") != "1" {
		t.Skip("native Keychain integration opt-in is unset")
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	service := config.ApplicationID + ".test." + hex.EncodeToString(suffix[:])
	backend := nativeSecretBackend()
	t.Cleanup(func() {
		if err := deleteIfPresent(backend, service, "synthetic"); err != nil {
			t.Error("unable to clean synthetic Keychain entry")
		}
	})
	if err := backend.Set(service, "synthetic", "synthetic-value"); err != nil {
		t.Fatal("unable to create synthetic Keychain entry")
	}
	got, err := backend.Get(service, "synthetic")
	if err != nil || got != "synthetic-value" {
		t.Fatal("native Keychain round trip failed")
	}
	if err := backend.Set(service, "synthetic", "synthetic-updated"); err != nil {
		t.Fatal("unable to update synthetic Keychain entry")
	}
	got, err = backend.Get(service, "synthetic")
	if err != nil || got != "synthetic-updated" {
		t.Fatal("native Keychain update failed")
	}
	if err := backend.Delete(service, "synthetic"); err != nil {
		t.Fatal("unable to delete synthetic Keychain entry")
	}
	if _, err := backend.Get(service, "synthetic"); err != errCredentialsNotFound {
		t.Fatal("deleted synthetic credential remained accessible")
	}
}
