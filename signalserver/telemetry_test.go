package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	collectormetrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestOTLPExportsTracesMetricsAndResourceOnShutdown(t *testing.T) {
	var mu sync.Mutex
	var traces collectortrace.ExportTraceServiceRequest
	var metrics collectormetrics.ExportMetricsServiceRequest
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		var err error
		switch r.URL.Path {
		case "/v1/traces":
			err = proto.Unmarshal(body, &traces)
		case "/v1/metrics":
			err = proto.Unmarshal(body, &metrics)
		default:
			t.Errorf("path=%s", r.URL.Path)
		}
		if err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
	}))
	defer collector.Close()
	t.Setenv("OTEL_SDK_DISABLED", "false")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	t.Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
	t.Setenv("OTEL_SERVICE_NAME", "test-api")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=test")
	t.Setenv("OTEL_TRACES_SAMPLER", "always_on")
	previousTrace, previousMetric, previousPropagation := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
	defer func() {
		otel.SetTracerProvider(previousTrace)
		otel.SetMeterProvider(previousMetric)
		otel.SetTextMapPropagator(previousPropagation)
	}()
	shutdown, err := initTelemetry(context.Background(), "fallback")
	if err != nil {
		t.Fatal(err)
	}
	_, span := otel.Tracer("test").Start(context.Background(), "test-operation")
	span.End()
	counter, err := otel.Meter("test").Int64Counter("test.requests")
	if err != nil {
		t.Fatal(err)
	}
	counter.Add(context.Background(), 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	// Repeated shutdown must be safe for deferred cleanup paths.
	if err := shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(traces.ResourceSpans) == 0 || len(metrics.ResourceMetrics) == 0 {
		t.Fatal("OTLP traces or metrics missing")
	}
	found := false
	for _, r := range traces.ResourceSpans {
		for _, a := range r.Resource.Attributes {
			if a.Key == "service.name" && a.Value.GetStringValue() == "test-api" {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("service resource not exported")
	}
}

func TestTelemetryDisabledDoesNotInstallExporter(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "true")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://unavailable:4318")
	before := otel.GetTracerProvider()
	shutdown, err := initTelemetry(context.Background(), "test")
	if err != nil {
		t.Fatal(err)
	}
	if before != otel.GetTracerProvider() {
		t.Fatal("disabled telemetry replaced global provider")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
