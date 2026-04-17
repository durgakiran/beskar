package core

import (
	"net/url"
	"os"
	"strings"
)

func IssuerHost() string {
	trimmed := strings.TrimSpace(os.Getenv("ISSUER_URL"))
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		parsed, err := url.Parse(trimmed)
		if err == nil && parsed.Host != "" {
			return parsed.Host
		}
	}
	return strings.TrimPrefix(strings.TrimPrefix(trimmed, "https://"), "http://")
}

func IssuerBaseURL() string {
	return normalizeExternalURL(os.Getenv("ISSUER_URL"))
}

func AllowedOriginsFromEnv() []string {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	if raw == "" {
		return []string{"http://localhost:3000", "http://localhost:8085"}
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		origins = append(origins, trimmed)
	}

	if len(origins) == 0 {
		return []string{"http://localhost:3000", "http://localhost:8085"}
	}

	return origins
}

func normalizeExternalURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	return "https://" + trimmed
}
