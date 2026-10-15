package notificationv2

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type AudienceConfig struct {
	Enabled                                                                 bool
	PollInterval, TransactionTimeout, LeaseDuration, RetryInitial, RetryMax time.Duration
	BatchSize, MaxAttempts, MaxRecipients                                   int
	HashKey                                                                 []byte
}

func DefaultAudienceConfig() AudienceConfig {
	return AudienceConfig{PollInterval: 2 * time.Second, TransactionTimeout: 30 * time.Second, LeaseDuration: time.Minute, RetryInitial: 30 * time.Second, RetryMax: 15 * time.Minute, BatchSize: 25, MaxAttempts: 5, MaxRecipients: 10000}
}
func LoadAudienceConfig() (AudienceConfig, error) {
	c := DefaultAudienceConfig()
	if v := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_EXPANDER_ENABLED")); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_EXPANDER_ENABLED")
		}
		c.Enabled = b
	}
	for _, v := range []struct {
		name   string
		target *time.Duration
	}{{"POLL_INTERVAL", &c.PollInterval}, {"TRANSACTION_TIMEOUT", &c.TransactionTimeout}, {"LEASE_DURATION", &c.LeaseDuration}, {"RETRY_INITIAL", &c.RetryInitial}, {"RETRY_MAX", &c.RetryMax}} {
		name := "NOTIFICATION_V2_EXPANDER_" + v.name
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			d, err := time.ParseDuration(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*v.target = d
		}
	}
	for _, v := range []struct {
		name   string
		target *int
	}{{"BATCH_SIZE", &c.BatchSize}, {"MAX_ATTEMPTS", &c.MaxAttempts}, {"MAX_RECIPIENTS", &c.MaxRecipients}} {
		name := "NOTIFICATION_V2_EXPANDER_" + v.name
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*v.target = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_DESTINATION_HASH_KEY")); raw != "" {
		key, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_DESTINATION_HASH_KEY encoding")
		}
		c.HashKey = key
	}
	return c, c.validate()
}
func (c AudienceConfig) validate() error {
	if c.PollInterval < 100*time.Millisecond || c.PollInterval > time.Hour || c.BatchSize < 1 || c.BatchSize > 1000 {
		return fmt.Errorf("invalid audience poll interval or batch size")
	}
	if c.TransactionTimeout < time.Second || c.TransactionTimeout > time.Minute || c.LeaseDuration < c.TransactionTimeout+10*time.Second || c.LeaseDuration > 10*time.Minute {
		return fmt.Errorf("audience lease must exceed transaction timeout by at least 10s; timeout 1s–1m and lease at most 10m")
	}
	if c.MaxAttempts < 1 || c.MaxAttempts > 100 || c.MaxRecipients < 1 || c.MaxRecipients > 100000 {
		return fmt.Errorf("invalid audience attempt or recipient limit")
	}
	if c.RetryInitial < time.Second || c.RetryMax < c.RetryInitial || c.RetryMax > 24*time.Hour {
		return fmt.Errorf("invalid audience retry delays")
	}
	if (c.Enabled || len(c.HashKey) > 0) && len(c.HashKey) < 32 {
		return fmt.Errorf("audience expander requires a destination hash key of at least 32 bytes")
	}
	return nil
}
