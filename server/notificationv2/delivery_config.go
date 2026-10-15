package notificationv2

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type DeliveryConfig struct {
	EmailEnabled, InAppEnabled                                   bool
	PollInterval, TransactionTimeout, SendTimeout, LeaseDuration time.Duration
	BatchSize                                                    int
	SMTPProviderID                                               uuid.UUID
	HashKey                                                      []byte
}

func DefaultDeliveryConfig() DeliveryConfig {
	return DeliveryConfig{PollInterval: time.Second, TransactionTimeout: 10 * time.Second, SendTimeout: 15 * time.Second, LeaseDuration: time.Minute, BatchSize: 25}
}
func LoadDeliveryConfig() (DeliveryConfig, error) {
	c := DefaultDeliveryConfig()
	for _, v := range []struct {
		name   string
		target *bool
	}{{"EMAIL_ENABLED", &c.EmailEnabled}, {"IN_APP_ENABLED", &c.InAppEnabled}} {
		name := "NOTIFICATION_V2_DELIVERY_" + v.name
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			b, err := strconv.ParseBool(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*v.target = b
		}
	}
	for _, v := range []struct {
		name   string
		target *time.Duration
	}{{"POLL_INTERVAL", &c.PollInterval}, {"TRANSACTION_TIMEOUT", &c.TransactionTimeout}, {"SEND_TIMEOUT", &c.SendTimeout}, {"LEASE_DURATION", &c.LeaseDuration}} {
		name := "NOTIFICATION_V2_DELIVERY_" + v.name
		if raw := strings.TrimSpace(os.Getenv(name)); raw != "" {
			d, err := time.ParseDuration(raw)
			if err != nil {
				return c, fmt.Errorf("invalid %s", name)
			}
			*v.target = d
		}
	}
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_DELIVERY_BATCH_SIZE")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return c, fmt.Errorf("invalid delivery batch size")
		}
		c.BatchSize = n
	}
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_SMTP_PROVIDER_ID")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return c, fmt.Errorf("invalid NOTIFICATION_V2_SMTP_PROVIDER_ID")
		}
		c.SMTPProviderID = id
	}
	if raw := strings.TrimSpace(os.Getenv("NOTIFICATION_V2_DESTINATION_HASH_KEY")); raw != "" {
		key, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return c, fmt.Errorf("invalid destination hash key encoding")
		}
		c.HashKey = key
	}
	return c, c.validate()
}
func (c DeliveryConfig) validate() error {
	if c.PollInterval < 100*time.Millisecond || c.PollInterval > time.Hour || c.BatchSize < 1 || c.BatchSize > 1000 {
		return fmt.Errorf("invalid delivery poll interval or batch size")
	}
	if c.TransactionTimeout < time.Second || c.TransactionTimeout > time.Minute || c.SendTimeout < time.Second || c.SendTimeout > time.Minute || c.LeaseDuration < c.SendTimeout+c.TransactionTimeout+10*time.Second || c.LeaseDuration > 10*time.Minute {
		return fmt.Errorf("delivery lease must exceed send + transaction timeouts by at least 10s; each timeout must be 1s–1m")
	}
	if (c.EmailEnabled || c.InAppEnabled) && len(c.HashKey) < 32 {
		return fmt.Errorf("delivery workers require the shared destination hash key")
	}
	if c.EmailEnabled && c.SMTPProviderID == uuid.Nil {
		return fmt.Errorf("email delivery requires NOTIFICATION_V2_SMTP_PROVIDER_ID")
	}
	return nil
}
