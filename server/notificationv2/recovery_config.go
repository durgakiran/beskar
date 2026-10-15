package notificationv2

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type RecoveryConfig struct {
	Enabled                          bool
	PollInterval, TransactionTimeout time.Duration
	BatchSize                        int
}

func DefaultRecoveryConfig() RecoveryConfig {
	return RecoveryConfig{PollInterval: 15 * time.Second, TransactionTimeout: 10 * time.Second, BatchSize: 100}
}
func LoadRecoveryConfig() (RecoveryConfig, error) {
	c := DefaultRecoveryConfig()
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_RECOVERY_ENABLED")); raw != "" {
		b, err := strconv.ParseBool(raw)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_RECOVERY_ENABLED")
		}
		c.Enabled = b
	}
	for _, v := range []struct {
		name   string
		target *time.Duration
	}{{"POLL_INTERVAL", &c.PollInterval}, {"TRANSACTION_TIMEOUT", &c.TransactionTimeout}} {
		name := "NOTIFICATION_V2_RECOVERY_" + v.name
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			d, err := time.ParseDuration(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*v.target = d
		}
	}
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_RECOVERY_BATCH_SIZE")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_RECOVERY_BATCH_SIZE")
		}
		c.BatchSize = n
	}
	return c, c.validate()
}
func (c RecoveryConfig) validate() error {
	if c.PollInterval < 100*time.Millisecond || c.PollInterval > time.Hour {
		return fmt.Errorf("recovery poll interval must be between 100ms and 1h")
	}
	if c.TransactionTimeout < time.Second || c.TransactionTimeout > time.Minute {
		return fmt.Errorf("recovery transaction timeout must be between 1s and 1m")
	}
	if c.BatchSize < 1 || c.BatchSize > 1000 {
		return fmt.Errorf("recovery batch size must be between 1 and 1000 per work kind")
	}
	return nil
}
