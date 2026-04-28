package quota

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AdminEnabled                bool
	AdminToken                  string
	ReconciliationEnabled       bool
	ReconciliationInterval      time.Duration
	QuotaSystemEnabled          bool
	StorageBlockingEnabled      bool
	CollaboratorBlockingEnabled bool
	MonitorOnlyEnabled          bool
}

func parseBoolEnv(key string, defaultValue bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultValue
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return defaultValue
	}
	return enabled
}

func parseDurationEnv(key string, defaultValue time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultValue
	}
	if duration, err := time.ParseDuration(value); err == nil && duration > 0 {
		return duration
	}
	return defaultValue
}

func LoadConfig() Config {
	quotaEnabled := parseBoolEnv("QUOTA_SYSTEM_ENABLED", true)
	return Config{
		AdminEnabled:                parseBoolEnv("QUOTA_ADMIN_ENABLED", false),
		AdminToken:                  strings.TrimSpace(os.Getenv("QUOTA_ADMIN_TOKEN")),
		ReconciliationEnabled:       parseBoolEnv("QUOTA_RECONCILIATION_ENABLED", false),
		ReconciliationInterval:      parseDurationEnv("QUOTA_RECONCILIATION_INTERVAL", 6*time.Hour),
		QuotaSystemEnabled:          quotaEnabled,
		StorageBlockingEnabled:      parseBoolEnv("QUOTA_STORAGE_BLOCKING_ENABLED", quotaEnabled),
		CollaboratorBlockingEnabled: parseBoolEnv("QUOTA_COLLABORATOR_BLOCKING_ENABLED", quotaEnabled),
		MonitorOnlyEnabled:          parseBoolEnv("QUOTA_MONITOR_ONLY", false),
	}
}
