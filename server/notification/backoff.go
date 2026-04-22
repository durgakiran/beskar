package notification

import (
	"math/rand"
	"time"
)

func retryDelay(attempt int, initial time.Duration, max time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if initial <= 0 {
		initial = 30 * time.Second
	}
	if max <= 0 {
		max = 6 * time.Hour
	}
	delay := initial
	for i := 1; i < attempt; i++ {
		delay *= 2
		if delay >= max {
			delay = max
			break
		}
	}
	if delay > max {
		delay = max
	}
	jitter := time.Duration(rand.Int63n(int64(delay/5 + 1)))
	return delay + jitter
}
