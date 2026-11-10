package transport

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Trust only the fixture's CA, while retaining certificate/hostname validation.
// Production transport tests must not depend on the development TLS exception.
func trustBackendCertificate(t *testing.T, backend *httptest.Server) {
	t.Helper()
	previous := http.DefaultTransport
	transport := previous.(*http.Transport).Clone()
	transport.TLSClientConfig = backend.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	transport.TLSClientConfig.InsecureSkipVerify = false
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previous; transport.CloseIdleConnections() })
}
