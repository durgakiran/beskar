package observability

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func recordSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	previous := otel.GetTracerProvider()
	previousPropagation := otel.GetTextMapPropagator()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(previous)
		otel.SetTextMapPropagator(previousPropagation)
	})
	return exporter
}

func TestHTTPContextRoutesLogsAndStreaming(t *testing.T) {
	exporter := recordSpans(t)
	loggingCore, logs := observer.New(zap.InfoLevel)
	router := chi.NewRouter()
	router.Use(RouteMiddleware(zap.New(loggingCore), true))
	nested := chi.NewRouter()
	nested.Get("/documents/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "private-secret" {
			t.Error("application query was altered")
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("SSE Flusher lost")
			return
		}
		_, span := otel.Tracer("test").Start(r.Context(), "database-work")
		span.End()
		w.WriteHeader(http.StatusOK)
		flusher.Flush()
	})
	router.Mount("/api", nested)
	req := httptest.NewRequest("GET", "/api/documents/42?token=private-secret", nil)
	req.Header.Set("traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
	HTTPHandler(router, "api").ServeHTTP(httptest.NewRecorder(), req)
	spans := exporter.GetSpans()
	if len(spans) != 2 {
		t.Fatalf("spans=%d", len(spans))
	}
	var httpSpan sdktrace.ReadOnlySpan
	for _, span := range spans {
		if span.Name == "GET /api/documents/{id}" {
			httpSpan = span.Snapshot()
		}
		for _, attr := range span.Attributes {
			if strings.Contains(attr.Value.Emit(), "private-secret") {
				t.Errorf("query leaked into %s", attr.Key)
			}
		}
	}
	if httpSpan == nil {
		t.Fatalf("bounded route name missing: %+v", spans)
	}
	if httpSpan.Parent().SpanID().String() != "0123456789abcdef" {
		t.Error("incoming parent not propagated")
	}
	for _, span := range spans {
		if span.Name == "database-work" && span.Parent.SpanID() != httpSpan.SpanContext().SpanID() {
			t.Error("dependency span disconnected")
		}
	}
	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("logs=%d", len(entries))
	}
	if entries[0].ContextMap()["trace.id"] != "0123456789abcdef0123456789abcdef" {
		t.Error("trace ID missing from request log")
	}
}

func TestHTTPPanicAndUnmatchedRoute(t *testing.T) {
	exporter := recordSpans(t)
	router := chi.NewRouter()
	router.Use(RouteMiddleware(zap.NewNop(), false))
	router.Use(middleware.Recoverer)
	router.Get("/panic", func(http.ResponseWriter, *http.Request) { panic("test failure") })
	handler := HTTPHandler(router, "api")
	for path, status := range map[string]int{"/panic": 500, "/missing/private-id": 404} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != status {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	for _, span := range exporter.GetSpans() {
		if strings.Contains(span.Name, "private-id") {
			t.Error("unmatched ID used in span name")
		}
	}
}

func TestOutgoingHTTPPreservesQueryAndTraceHeaders(t *testing.T) {
	exporter := recordSpans(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != "private-secret" {
			t.Error("outbound query lost")
		}
		if r.Header.Get("traceparent") == "" {
			t.Error("trace context not propagated")
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()
	ctx, span := otel.Tracer("test").Start(context.Background(), "request")
	client := &http.Client{Transport: NewTransport(http.DefaultTransport)}
	request, _ := http.NewRequestWithContext(ctx, "GET", upstream.URL+"?token=private-secret", nil)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	span.End()
	if len(exporter.GetSpans()) != 2 {
		t.Fatal("outbound HTTP span missing")
	}
	for _, span := range exporter.GetSpans() {
		for _, a := range span.Attributes {
			if strings.Contains(a.Value.Emit(), "private-secret") {
				t.Errorf("outbound query leaked into %s", a.Key)
			}
		}
	}
}
