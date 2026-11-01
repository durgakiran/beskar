package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/extra/redisotel/v9"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// initTelemetry is opt-in: an OTLP endpoint must be configured and OTEL_SDK_DISABLED must
// not be true. Exporters connect asynchronously to the Collector.
func initTelemetry(ctx context.Context, service string) (func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	disabled := false
	if value := strings.TrimSpace(os.Getenv("OTEL_SDK_DISABLED")); value != "" {
		var err error
		disabled, err = strconv.ParseBool(value)
		if err != nil {
			return nil, fmt.Errorf("OTEL_SDK_DISABLED: %w", err)
		}
	}
	if disabled {
		return noop, nil
	}
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" && os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" && os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") == "" {
		return noop, nil
	}
	for _, key := range []string{"OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL"} {
		if protocol := os.Getenv(key); protocol != "" && protocol != "http/protobuf" {
			return nil, fmt.Errorf("%s must be http/protobuf", key)
		}
	}
	res, err := resource.New(ctx, resource.WithAttributes(attribute.String("service.name", service)), resource.WithFromEnv(), resource.WithTelemetrySDK())
	if err != nil {
		return nil, err
	}
	traceExporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	metricExporter, err := otlpmetrichttp.New(ctx)
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = traceExporter.Shutdown(cleanup)
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(traceExporter))
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithResource(res), sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)))
	if err := runtime.Start(runtime.WithMeterProvider(mp)); err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tp.Shutdown(cleanup)
		_ = mp.Shutdown(cleanup)
		return nil, err
	}
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	var once sync.Once
	var shutdownError error
	return func(ctx context.Context) error {
		once.Do(func() { shutdownError = errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx)) })
		return shutdownError
	}, nil
}

// instrumentRedis deliberately omits command arguments (session tokens, payloads).
func instrumentRedis(client *redis.Client) error {
	if err := redisotel.InstrumentTracing(client, redisotel.WithDBStatement(false)); err != nil {
		return err
	}
	return redisotel.InstrumentMetrics(client)
}
