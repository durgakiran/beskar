package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/observability"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
)

func TestRequestDependencySpans(t *testing.T) {
	if os.Getenv("OTEL_INTEGRATION_TEST") != "true" {
		t.Skip("set OTEL_INTEGRATION_TEST=true with PG_* and OTEL_TEST_REDIS_ADDR for isolated test databases")
	}
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(provider)
	defer func() { _ = provider.Shutdown(context.Background()); otel.SetTracerProvider(previous) }()
	pool, err := pgxpool.NewWithConfig(context.Background(), Config())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(&redis.Options{Addr: os.Getenv("OTEL_TEST_REDIS_ADDR")})
	defer client.Close()
	if err := observability.InstrumentRedis(client); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Use(observability.RouteMiddleware(zap.NewNop(), false))
	router.Get("/probe", func(w http.ResponseWriter, r *http.Request) {
		var value string
		if err := pool.QueryRow(r.Context(), "SELECT $1::text", "private-sql-value").Scan(&value); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if err := client.Set(r.Context(), "private-session-token", "private-document-payload", 0).Err(); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(200)
	})
	response := httptest.NewRecorder()
	observability.HTTPHandler(router, "test").ServeHTTP(response, httptest.NewRequest("GET", "/probe", nil))
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	spans := exporter.GetSpans()
	rootID := ""
	for _, span := range spans {
		if span.Name == "GET /probe" {
			rootID = span.SpanContext.TraceID().String()
		}
	}
	if rootID == "" {
		t.Fatal("server span missing")
	}
	databases := map[string]bool{}
	for _, span := range spans {
		for _, a := range span.Attributes {
			if a.Key == "db.system" && span.SpanContext.TraceID().String() == rootID {
				databases[a.Value.AsString()] = true
			}
			for _, secret := range []string{"private-sql-value", "private-session-token", "private-document-payload"} {
				if strings.Contains(a.Value.Emit(), secret) || strings.Contains(span.Name, secret) {
					t.Errorf("secret in span %s attribute %s", span.Name, a.Key)
				}
			}
		}
	}
	if !databases["postgresql"] || !databases["redis"] {
		t.Fatalf("missing connected database spans: %+v", databases)
	}
}
