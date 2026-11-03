package config

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSelfSignedDevelopmentOptIn(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	for _, value := range []string{"", "true", "1"} {
		t.Run("env="+value, func(t *testing.T) {
			t.Setenv("BESKAR_DEV_ALLOW_SELF_SIGNED", value)
			transport := NewHTTPTransport()
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport}
			response, err := client.Get(server.URL)
			if response != nil {
				response.Body.Close()
			}
			if value == "1" {
				if err != nil {
					t.Fatalf("development certificate rejected: %v", err)
				}
			} else if err == nil {
				t.Fatal("untrusted certificate accepted without explicit opt-in")
			}
		})
	}
}
