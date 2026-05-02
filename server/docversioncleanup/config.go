package docversioncleanup

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Enabled              bool
	DryRun               bool
	AdminEnabled         bool
	AdminToken           string
	DefaultRetentionDays int
	BatchSize            int
	MaxDocsPerRun        int
	Interval             time.Duration
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
		Enabled:              parseBoolEnv("DOCUMENT_VERSION_CLEANUP_ENABLED", false),
		DryRun:               parseBoolEnv("DOCUMENT_VERSION_CLEANUP_DRY_RUN", true),
		AdminEnabled:         parseBoolEnv("DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED", false),
		AdminToken:           strings.TrimSpace(os.Getenv("DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN")),
		DefaultRetentionDays: parseIntEnv("DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS", 7),
		BatchSize:            parseIntEnv("DOCUMENT_VERSION_CLEANUP_BATCH_SIZE", 500),
		MaxDocsPerRun:        parseIntEnv("DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN", 500),
		Interval:             parseDurationEnv("DOCUMENT_VERSION_CLEANUP_INTERVAL", 24*time.Hour),
	}
}
