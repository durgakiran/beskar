package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestWebSocketTracingPreservesHandshakeAndBinaryMessages(t *testing.T) {
	oldHub, oldProvider, oldPropagation := hub, otel.GetTracerProvider(), otel.GetTextMapPropagator()
	hub = newHub()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(oldProvider)
		otel.SetTextMapPropagator(oldPropagation)
		hub = oldHub
	}()
	auth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-secret" {
			t.Error("authentication credential was altered")
		}
		if r.Header.Get("traceparent") == "" {
			t.Error("auth request has no trace context")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer auth.Close()
	t.Setenv("AUTH_SERVER_URL", auth.URL)
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
	server := httptest.NewServer(setupRoutes())
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?token=private-secret"
	headers := http.Header{"Origin": []string{"http://localhost:3000"}}
	first, _, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, _, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	// The handshake span must finish while the WebSocket remains open.
	deadline := time.Now().Add(time.Second)
	for len(exporter.GetSpans()) < 4 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	handshakes := 0
	for _, span := range exporter.GetSpans() {
		if span.Name == "GET /ws" {
			handshakes++
		}
	}
	if handshakes != 2 {
		t.Fatalf("unfinished handshake spans: %d", handshakes)
	}
	for _, client := range []*websocket.Conn{first, second} {
		_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
		if err := client.WriteJSON(Message{Type: "subscribe", Topics: []string{"document-v2:test:42"}}); err != nil {
			t.Fatal(err)
		}
		if err := client.WriteJSON(Message{Type: "ping"}); err != nil {
			t.Fatal(err)
		}
		var pong Message
		if err := client.ReadJSON(&pong); err != nil || pong.Type != "pong" {
			t.Fatalf("pong: %+v %v", pong, err)
		}
	}
	payload := []byte{0, 1, 2, 3, 255}
	if err := first.WriteMessage(websocket.BinaryMessage, payload); err != nil {
		t.Fatal(err)
	}
	kind, received, err := second.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || string(received) != string(payload) {
		t.Fatalf("binary forwarding changed: %d %v %v", kind, received, err)
	}
	_ = first.Close()
	_ = second.Close()
	deadline = time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		count := 0
		hub.connections.Range(func(_, _ any) bool { count++; return true })
		if count == 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	messages := 0
	for _, span := range exporter.GetSpans() {
		if span.Name == "WebSocket/Message" {
			messages++
		}
		for _, a := range span.Attributes {
			if strings.Contains(a.Value.Emit(), "private-secret") {
				t.Errorf("credential leaked into %s", a.Key)
			}
		}
	}
	if messages < 5 {
		t.Fatalf("message spans missing: %d", messages)
	}
}
