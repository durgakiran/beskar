package config

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBuildTLSVerificationPolicy(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	for _, value := range []string{"", "0", "true", "1"} {
		for _, certificate := range []string{"untrusted chain", "trusted chain", "wrong hostname"} {
			t.Run("env="+value+"/"+certificate, func(t *testing.T) {
				t.Setenv("BESKAR_DEV_ALLOW_SELF_SIGNED", value)
				transport := NewHTTPTransport()
				defer transport.CloseIdleConnections()
				if certificate != "untrusted chain" {
					transport.TLSClientConfig.RootCAs = roots
				}
				if certificate == "wrong hostname" {
					transport.TLSClientConfig.ServerName = "different.example.invalid"
				}
				client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
				response, err := client.Get(server.URL)
				if response != nil {
					response.Body.Close()
				}
				bypass := developmentBuild && value == "1"
				if bypass || certificate == "trusted chain" {
					if err != nil {
						t.Fatalf("expected valid/explicitly permitted development TLS: %v", err)
					}
					return
				}
				if err == nil {
					t.Fatal("invalid certificate accepted")
				}
				if certificate == "wrong hostname" {
					var hostname x509.HostnameError
					if !errors.As(err, &hostname) {
						t.Fatalf("expected hostname rejection, got %T", err)
					}
				} else {
					var authority x509.UnknownAuthorityError
					if !errors.As(err, &authority) {
						t.Fatalf("expected certificate-chain rejection, got %T", err)
					}
				}
			})
		}
	}
}

func TestTransportDoesNotInheritAnInsecureDefault(t *testing.T) {
	t.Setenv("BESKAR_DEV_ALLOW_SELF_SIGNED", "")
	old := http.DefaultTransport
	altered := old.(*http.Transport).Clone()
	altered.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	http.DefaultTransport = altered
	defer func() { http.DefaultTransport = old }()
	transport := NewHTTPTransport()
	defer transport.CloseIdleConnections()
	if transport.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("insecure default transport policy was inherited")
	}
	if !altered.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("shared default transport was mutated")
	}
}
