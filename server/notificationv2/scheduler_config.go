package notificationv2

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type SchedulerConfig struct {
	Enabled            bool
	PollInterval       time.Duration
	BatchSize          int
	MisfireGrace       time.Duration
	TransactionTimeout time.Duration
}

func DefaultSchedulerConfig() SchedulerConfig {
	return SchedulerConfig{PollInterval: time.Second, BatchSize: 100, MisfireGrace: time.Minute, TransactionTimeout: 10 * time.Second}
}

func LoadSchedulerConfig() (SchedulerConfig, error) {
	c := DefaultSchedulerConfig()
	if v := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_SCHEDULER_ENABLED")); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_SCHEDULER_ENABLED")
		}
		c.Enabled = b
	}
	for _, entry := range []struct {
		name   string
		target *time.Duration
	}{
		{"NOTIFICATION_V2_SCHEDULER_POLL_INTERVAL", &c.PollInterval},
		{"NOTIFICATION_V2_SCHEDULER_MISFIRE_GRACE", &c.MisfireGrace},
		{"NOTIFICATION_V2_SCHEDULER_TRANSACTION_TIMEOUT", &c.TransactionTimeout},
	} {
		if v := strings.TrimSpace(os.Getenv(entry.name)); v != "" {
			parsed, err := time.ParseDuration(v)
			if err != nil {
				return c, fmt.Errorf("invalid %s", entry.name)
			}
			*entry.target = parsed
		}
	}
	if v := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_SCHEDULER_BATCH_SIZE")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_SCHEDULER_BATCH_SIZE")
		}
		c.BatchSize = n
	}
	return c, c.validate()
}
func (c SchedulerConfig) validate() error {
	if c.PollInterval < 100*time.Millisecond || c.PollInterval > time.Hour {
		return fmt.Errorf("scheduler poll interval must be between 100ms and 1h")
	}
	if c.BatchSize < 1 || c.BatchSize > 1000 {
		return fmt.Errorf("scheduler batch size must be between 1 and 1000")
	}
	if c.MisfireGrace < 0 || c.MisfireGrace > 24*time.Hour {
		return fmt.Errorf("scheduler misfire grace must be between 0s and 24h")
	}
	if c.TransactionTimeout < time.Second || c.TransactionTimeout > time.Minute {
		return fmt.Errorf("scheduler transaction timeout must be between 1s and 1m")
	}
	return nil
}
