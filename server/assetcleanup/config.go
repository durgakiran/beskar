package assetcleanup

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Enabled         bool
	DryRun          bool
	PurgeEnabled    bool
	AdminEnabled    bool
	AdminToken      string
	MarkInterval    time.Duration
	PurgeInterval   time.Duration
	OrphanGrace     time.Duration
	PurgeGrace      time.Duration
	MaxMarksPerRun  int
	MaxPurgesPerRun int
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
	d, err := time.ParseDuration(value)
	if err != nil || d <= 0 {
		return defaultValue
	}
	return d
}

func parseIntEnv(key string, defaultValue int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultValue
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return defaultValue
	}
	return parsed
}

func LoadConfig() Config {
	return Config{
		Enabled:         parseBoolEnv("ASSET_CLEANUP_ENABLED", false),
		DryRun:          parseBoolEnv("ASSET_CLEANUP_DRY_RUN", true),
		PurgeEnabled:    parseBoolEnv("ASSET_CLEANUP_PURGE_ENABLED", false),
		AdminEnabled:    parseBoolEnv("ASSET_CLEANUP_ADMIN_ENABLED", false),
		AdminToken:      strings.TrimSpace(os.Getenv("ASSET_CLEANUP_ADMIN_TOKEN")),
		MarkInterval:    parseDurationEnv("ASSET_CLEANUP_MARK_INTERVAL", time.Hour),
		PurgeInterval:   parseDurationEnv("ASSET_CLEANUP_PURGE_INTERVAL", 6*time.Hour),
		OrphanGrace:     parseDurationEnv("ASSET_CLEANUP_ORPHAN_GRACE", 24*time.Hour),
		PurgeGrace:      parseDurationEnv("ASSET_CLEANUP_PURGE_GRACE", 7*24*time.Hour),
		MaxMarksPerRun:  parseIntEnv("ASSET_CLEANUP_MAX_MARKS_PER_RUN", 100),
		MaxPurgesPerRun: parseIntEnv("ASSET_CLEANUP_MAX_PURGES_PER_RUN", 50),
	}
}
