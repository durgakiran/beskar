package searchsync

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	CaptureEnabled, WorkerEnabled                            bool
	Database                                                 DatabaseConfig
	PollInterval, TransactionTimeout, RetryInitial, RetryMax time.Duration
	BatchSize, MaxAttempts                                   int
}

func DefaultConfig() Config {
	return Config{PollInterval: time.Second, TransactionTimeout: 30 * time.Second, RetryInitial: time.Second, RetryMax: 5 * time.Minute, BatchSize: 25, MaxAttempts: 10}
}

func LoadConfig() (Config, error) {
	c := DefaultConfig()
	for _, v := range []struct {
		name   string
		target *bool
	}{{"CAPTURE_ENABLED", &c.CaptureEnabled}, {"WORKER_ENABLED", &c.WorkerEnabled}} {
		value, err := boolEnv("SEARCH_SYNC_" + v.name)
		if err != nil {
			return c, err
		}
		*v.target = value
	}
	c.Database = DatabaseConfig{
		Host: os.Getenv("PG_SEARCH_HOST"), Port: os.Getenv("PG_SEARCH_PORT"),
		Name: os.Getenv("PG_SEARCH_DB"), User: os.Getenv("PG_SEARCH_USER"),
		Password: os.Getenv("PG_SEARCH_PASSWORD"), SSLMode: os.Getenv("PG_SEARCH_SSLMODE"),
	}
	for _, v := range []struct {
		name   string
		target *time.Duration
	}{{"POLL_INTERVAL", &c.PollInterval}, {"TRANSACTION_TIMEOUT", &c.TransactionTimeout}, {"RETRY_INITIAL", &c.RetryInitial}, {"RETRY_MAX", &c.RetryMax}} {
		if raw := strings.TrimSpace(os.Getenv("SEARCH_SYNC_" + v.name)); raw != "" {
			value, err := time.ParseDuration(raw)
			if err != nil {
				return c, fmt.Errorf("invalid SEARCH_SYNC_%s", v.name)
			}
			*v.target = value
		}
	}
	for _, v := range []struct {
		name   string
		target *int
	}{{"BATCH_SIZE", &c.BatchSize}, {"MAX_ATTEMPTS", &c.MaxAttempts}} {
		if raw := strings.TrimSpace(os.Getenv("SEARCH_SYNC_" + v.name)); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil {
				return c, fmt.Errorf("invalid SEARCH_SYNC_%s", v.name)
			}
			*v.target = value
		}
	}
	return c, c.validate()
}

func boolEnv(name string) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return false, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("invalid %s", name)
	}
	return value, nil
}

func (c Config) validate() error {
	if c.PollInterval < 100*time.Millisecond || c.PollInterval > time.Hour || c.TransactionTimeout < time.Second || c.TransactionTimeout > 5*time.Minute {
		return fmt.Errorf("invalid search sync poll interval or transaction timeout")
	}
	if c.BatchSize < 1 || c.BatchSize > 1000 || c.MaxAttempts < 1 || c.MaxAttempts > 100 || c.RetryInitial < time.Second || c.RetryMax < c.RetryInitial || c.RetryMax > 24*time.Hour {
		return fmt.Errorf("invalid search sync batch/retry configuration")
	}
	if c.WorkerEnabled {
		if _, err := c.Database.poolConfig(); err != nil {
			return err
		}
	}
	return nil
}

func (c Config) retryDelay(attempt int) time.Duration {
	delay := c.RetryInitial
	for i := 1; i < attempt && delay < c.RetryMax; i++ {
		if delay > c.RetryMax/2 {
			return c.RetryMax
		}
		delay *= 2
	}
	if delay > c.RetryMax {
		return c.RetryMax
	}
	return delay
}
