package notification

import (
	"testing"
	"time"
)

func TestRetryDelayGrowsAndCaps(t *testing.T) {
	initial := 10 * time.Second
	maxDelay := 60 * time.Second

	first := retryDelay(1, initial, maxDelay)
	third := retryDelay(3, initial, maxDelay)
	tenth := retryDelay(10, initial, maxDelay)

	if first < initial {
		t.Fatalf("expected first delay >= initial, got %s", first)
	}
	if third < 40*time.Second {
		t.Fatalf("expected third delay to grow near 40s, got %s", third)
	}
	if tenth > maxDelay+(maxDelay/5) {
		t.Fatalf("expected capped delay with jitter, got %s", tenth)
	}
}
