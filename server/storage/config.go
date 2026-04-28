package storage

import (
	"fmt"
	"os"
	"path"
	"strings"
)

const (
	envBucket          = "STORAGE_S3_BUCKET"
	envEndpoint        = "STORAGE_S3_ENDPOINT"
	envRegion          = "STORAGE_S3_REGION"
	envAccessKeyID     = "STORAGE_S3_ACCESS_KEY_ID"
	envSecretAccessKey = "STORAGE_S3_SECRET_ACCESS_KEY"
	envPrefix          = "STORAGE_S3_PREFIX"
	envBaseURL         = "STORAGE_S3_BASE_URL"
)

// Config contains the runtime bucket configuration for blob storage.
type Config struct {
	Bucket          string
	Endpoint        string
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	Prefix          string
	BaseURL         string
}

func LoadConfigFromEnv() (Config, error) {
	cfg := Config{
		Bucket:          strings.TrimSpace(os.Getenv(envBucket)),
		Endpoint:        strings.TrimSpace(os.Getenv(envEndpoint)),
		Region:          strings.TrimSpace(os.Getenv(envRegion)),
		AccessKeyID:     strings.TrimSpace(os.Getenv(envAccessKeyID)),
		SecretAccessKey: strings.TrimSpace(os.Getenv(envSecretAccessKey)),
		Prefix:          normalizePrefix(os.Getenv(envPrefix)),
		BaseURL:         strings.TrimSpace(os.Getenv(envBaseURL)),
	}
	return cfg, cfg.Validate()
}

func (c Config) Validate() error {
	var missing []string
	if c.Bucket == "" {
		missing = append(missing, envBucket)
	}
	if c.Endpoint == "" {
		missing = append(missing, envEndpoint)
	}
	if c.Region == "" {
		missing = append(missing, envRegion)
	}
	if c.AccessKeyID == "" {
		missing = append(missing, envAccessKeyID)
	}
	if c.SecretAccessKey == "" {
		missing = append(missing, envSecretAccessKey)
	}
	if len(missing) > 0 {
		return fmt.Errorf("storage: missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}

func normalizePrefix(raw string) string {
	prefix := strings.TrimSpace(raw)
	if prefix == "" {
		return ""
	}
	cleaned := path.Clean(strings.ReplaceAll(prefix, "\\", "/"))
	switch cleaned {
	case ".", "/", "":
		return ""
	default:
		return strings.Trim(cleaned, "/")
	}
}
