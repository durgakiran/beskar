//go:build beskar_dev && !beskar_alpha

package config

import "os"

// This opt-in disables certificate AND hostname verification. Use a local CA
// instead whenever possible. It never changes WebView or operating-system trust.
func allowDevelopmentTLSException() bool {
	return os.Getenv("BESKAR_DEV_ALLOW_SELF_SIGNED") == "1"
}
