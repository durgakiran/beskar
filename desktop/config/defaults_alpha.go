//go:build beskar_alpha

package config

var (
	DefaultServerURL  = "https://app.teddox.com"
	DefaultZitadelURL = "https://id.teddox.com"
	// Supply the production native public-client ID through release ldflags.
	// An empty value fails authentication rather than using a development client.
	DefaultClientID string
)
