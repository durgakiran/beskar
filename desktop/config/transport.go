package config

import (
	"crypto/tls"
	"net/http"
)

// NewHTTPTransport verifies certificates in normal builds. Only beskar_dev
// builds include the explicit process-level TLS exception.
func NewHTTPTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if transport.TLSClientConfig == nil {
		transport.TLSClientConfig = &tls.Config{}
	}
	transport.TLSClientConfig.InsecureSkipVerify = allowDevelopmentTLSException()
	return transport
}
