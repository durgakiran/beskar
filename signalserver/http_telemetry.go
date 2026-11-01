package main

import (
	"context"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"net/http"
	"os"
	"time"
)

var signalHTTPClient = &http.Client{Timeout: 10 * time.Second, Transport: signalTransport(http.DefaultTransport)}
var signalMessages, _ = otel.Meter("beskar/signal").Int64Counter("signal.messages")
var signalMessageDuration, _ = otel.Meter("beskar/signal").Float64Histogram("signal.message.duration", metric.WithUnit("s"))
var activeSignalConnections, _ = otel.Meter("beskar/signal").Int64UpDownCounter("signal.connections")

type originalRequestKey struct{}
type originalOutgoingRequestKey struct{}
type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// HTTPHandler excludes query credentials from HTTP attributes while preserving
// the original request, Flusher and Hijacker for application handlers.
func signalHTTPHandler(next http.Handler, operation string) http.Handler {
	traced := otelhttp.NewHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		original := r.Context().Value(originalRequestKey{}).(*http.Request)
		next.ServeHTTP(w, original.WithContext(r.Context()))
	}), operation, otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/" }))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sanitized := r.Clone(context.WithValue(r.Context(), originalRequestKey{}, r))
		sanitized.URL.RawQuery = ""
		sanitized.URL.User = nil
		sanitized.URL.ForceQuery = false
		sanitized.RequestURI = sanitized.URL.RequestURI()
		traced.ServeHTTP(w, sanitized)
	})
}

// NewTransport preserves a client's timeout, redirect and dial/TLS behavior.
func signalTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	traced := otelhttp.NewTransport(transportFunc(func(r *http.Request) (*http.Response, error) {
		original := r.Context().Value(originalOutgoingRequestKey{}).(*http.Request)
		outgoing := original.Clone(r.Context())
		outgoing.Header = r.Header
		return base.RoundTrip(outgoing)
	}))
	return transportFunc(func(r *http.Request) (*http.Response, error) {
		sanitized := r.Clone(context.WithValue(r.Context(), originalOutgoingRequestKey{}, r))
		sanitized.URL.RawQuery = ""
		sanitized.URL.ForceQuery = false
		sanitized.URL.User = nil
		return traced.RoundTrip(sanitized)
	})
}

var signalLogger = slog.New(slog.NewJSONHandler(os.Stderr, nil)).With("service", "signalserver")

func signalRequestLogger(ctx context.Context) *slog.Logger {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return signalLogger
	}
	return signalLogger.With("trace.id", sc.TraceID().String(), "span.id", sc.SpanID().String())
}
