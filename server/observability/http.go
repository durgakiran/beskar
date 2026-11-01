package observability

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type originalRequestKey struct{}
type originalOutgoingRequestKey struct{}
type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// HTTPHandler excludes query credentials from HTTP attributes while preserving
// the original request, Flusher and Hijacker for application handlers.
func HTTPHandler(next http.Handler, operation string) http.Handler {
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

func RequestLogger(ctx context.Context, logger *zap.Logger) *zap.Logger {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return logger
	}
	return logger.With(zap.String("trace.id", sc.TraceID().String()), zap.String("span.id", sc.SpanID().String()))
}

// RouteMiddleware applies bounded Chi patterns after routing and optionally
// records structured request summaries. Unmatched requests never use raw IDs.
func RouteMiddleware(logger *zap.Logger, logAll bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			writer := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(writer, r)
			pattern := chi.RouteContext(r.Context()).RoutePattern()
			if pattern == "" {
				pattern = "unmatched"
			}
			span := trace.SpanFromContext(r.Context())
			span.SetName(r.Method + " " + pattern)
			span.SetAttributes(attribute.String("http.route", pattern))
			labeler, _ := otelhttp.LabelerFromContext(r.Context())
			labeler.Add(attribute.String("http.route", pattern))
			status := writer.Status()
			if status == 0 {
				status = http.StatusOK
			}
			elapsed := time.Since(started)
			fields := []zap.Field{zap.String("http.method", r.Method), zap.String("http.route", pattern), zap.Int("http.status_code", status), zap.Duration("duration", elapsed)}
			requestLogger := RequestLogger(r.Context(), logger)
			switch {
			case status >= 500:
				requestLogger.Error("HTTP request failed", fields...)
			case elapsed >= time.Second && !strings.HasPrefix(writer.Header().Get("Content-Type"), "text/event-stream"):
				requestLogger.Warn("Slow HTTP request", fields...)
			case logAll && r.URL.Path != "/":
				requestLogger.Info("HTTP request", fields...)
			}
		})
	}
}

// NewTransport preserves a client's timeout, redirect and dial/TLS behavior.
func NewTransport(base http.RoundTripper) http.RoundTripper {
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
