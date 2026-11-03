package config

import (
	"crypto/tls"
	"net/http"
	"os"
)

// NewHTTPTransport permits self-signed development certificates only when
// explicitly enabled for this process. It does not change the OS trust store.
func NewHTTPTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{
		InsecureSkipVerify: os.Getenv("BESKAR_DEV_ALLOW_SELF_SIGNED") == "1",
	}
	return transport
}
