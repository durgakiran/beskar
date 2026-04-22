package notification

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	NotificationsEnabled bool
	WorkerEnabled        bool
	AdminEnabled         bool
	AdminToken           string
	Provider             string
	FromAddress          string
	FromName             string
	AppBaseURL           string
	SMTPHost             string
	SMTPPort             int
	SMTPUsername         string
	SMTPPassword         string
	SMTPUseTLS           bool
	SMTPTimeout          time.Duration
	WorkerPollInterval   time.Duration
	WorkerBatchSize      int
	MaxAttempts          int
	RetryInitialDelay    time.Duration
	RetryMaxDelay        time.Duration
}

func LoadConfig() Config {
	return Config{
		NotificationsEnabled: envBool("EMAIL_NOTIFICATIONS_ENABLED", false),
		WorkerEnabled:        envBool("EMAIL_WORKER_ENABLED", false),
		AdminEnabled:         envBool("EMAIL_ADMIN_ENABLED", false),
		AdminToken:           strings.TrimSpace(os.Getenv("EMAIL_ADMIN_TOKEN")),
		Provider:             envString("EMAIL_PROVIDER", "smtp"),
		FromAddress:          strings.TrimSpace(os.Getenv("EMAIL_FROM_ADDRESS")),
		FromName:             envString("EMAIL_FROM_NAME", "Beskar"),
		AppBaseURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("EMAIL_APP_BASE_URL")), "/"),
		SMTPHost:             strings.TrimSpace(os.Getenv("SMTP_HOST")),
		SMTPPort:             envInt("SMTP_PORT", 587),
		SMTPUsername:         strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		SMTPPassword:         os.Getenv("SMTP_PASSWORD"),
		SMTPUseTLS:           envBool("SMTP_USE_TLS", true),
		SMTPTimeout:          time.Duration(envInt("SMTP_TIMEOUT_SECONDS", 10)) * time.Second,
		WorkerPollInterval:   time.Duration(envInt("EMAIL_WORKER_POLL_INTERVAL_SECONDS", 10)) * time.Second,
		WorkerBatchSize:      envInt("EMAIL_WORKER_BATCH_SIZE", 25),
		MaxAttempts:          envInt("EMAIL_MAX_ATTEMPTS", 10),
		RetryInitialDelay:    time.Duration(envInt("EMAIL_RETRY_INITIAL_SECONDS", 30)) * time.Second,
		RetryMaxDelay:        time.Duration(envInt("EMAIL_RETRY_MAX_SECONDS", 21600)) * time.Second,
	}
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
