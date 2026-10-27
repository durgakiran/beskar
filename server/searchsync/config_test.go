package searchsync

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/durgakiran/beskar/searchtext"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestRetryDelay(t *testing.T) {
	c := DefaultConfig()
	c.RetryMax = 5 * time.Second
	for i, want := range []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 5 * time.Second, 5 * time.Second} {
		if got := c.retryDelay(i + 1); got != want {
			t.Fatalf("attempt %d: %s != %s", i+1, got, want)
		}
	}
	if c.retryDelay(100) != 5*time.Second {
		t.Fatal("retry overflow")
	}
}
func TestConfigValidation(t *testing.T) {
	for _, mutate := range []func(*Config){func(c *Config) { c.BatchSize = 0 }, func(c *Config) { c.MaxAttempts = 0 }, func(c *Config) { c.RetryMax = 0 }, func(c *Config) { c.PollInterval = 0 }, func(c *Config) { c.WorkerEnabled = true }, func(c *Config) {
		c.WorkerEnabled = true
		c.Database = DatabaseConfig{Host: "host", Port: "invalid", Name: "search", User: "writer", Password: "secret"}
	}} {
		c := DefaultConfig()
		mutate(&c)
		err := c.validate()
		if err == nil {
			t.Fatal("expected invalid config")
		}
		if strings.Contains(err.Error(), "secret") {
			t.Fatal("credentials leaked")
		}
	}
	if err := DefaultConfig().validate(); err != nil {
		t.Fatal(err)
	}
}
func TestDisabledProducerAndWorker(t *testing.T) {
	t.Setenv("SEARCH_SYNC_CAPTURE_ENABLED", "false")
	if err := QueuePage(context.Background(), nil, 0, 0); err != nil {
		t.Fatal(err)
	}
	w := Worker{config: DefaultConfig()}
	select {
	case <-w.Start(context.Background()):
	default:
		t.Fatal("disabled worker did not close")
	}
	t.Setenv("SEARCH_SYNC_CAPTURE_ENABLED", "invalid")
	if err := QueuePage(context.Background(), nil, 1, ReasonDocumentCreated); err == nil {
		t.Fatal("invalid boolean accepted")
	}
}
func TestErrorCodes(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{{context.Canceled, "canceled"}, {context.DeadlineExceeded, "timeout"}, {&searchtext.Error{Kind: "invalid_node"}, "extraction_invalid_node"}, {&pgconn.PgError{Code: "23505", Detail: "private body"}, "postgres_23505"}, {errors.New("private body"), "database_or_transport"}}
	for _, tt := range cases {
		if got := errorCode(tt.err); got != tt.want {
			t.Fatalf("%s != %s", got, tt.want)
		}
	}
}
