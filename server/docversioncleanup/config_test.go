package docversioncleanup

import (
	"testing"
	"time"
)

func TestLoadConfigDefaults(t *testing.T) {
	clearConfigEnv(t)

	cfg := LoadConfig()

	if cfg.Enabled {
		t.Fatal("expected cleanup to be disabled by default")
	}
	if !cfg.DryRun {
		t.Fatal("expected dry run to be enabled by default")
	}
	if cfg.AdminEnabled {
		t.Fatal("expected admin routes to be disabled by default")
	}
	if cfg.AdminToken != "" {
		t.Fatalf("expected empty admin token, got %q", cfg.AdminToken)
	}
	if cfg.DefaultRetentionDays != 7 {
		t.Fatalf("expected default retention 7, got %d", cfg.DefaultRetentionDays)
	}
	if cfg.BatchSize != 500 {
		t.Fatalf("expected batch size 500, got %d", cfg.BatchSize)
	}
	if cfg.MaxDocsPerRun != 500 {
		t.Fatalf("expected max docs per run 500, got %d", cfg.MaxDocsPerRun)
	}
	if cfg.Interval != 24*time.Hour {
		t.Fatalf("expected interval 24h, got %s", cfg.Interval)
	}
}

func TestLoadConfigFromEnv(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("DOCUMENT_VERSION_CLEANUP_ENABLED", "true")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_DRY_RUN", "false")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED", "true")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN", "token")
	t.Setenv("DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS", "14")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_BATCH_SIZE", "25")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN", "75")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_INTERVAL", "2h")

	cfg := LoadConfig()

	if !cfg.Enabled {
		t.Fatal("expected cleanup to be enabled")
	}
	if cfg.DryRun {
		t.Fatal("expected dry run to be disabled")
	}
	if !cfg.AdminEnabled {
		t.Fatal("expected admin routes to be enabled")
	}
	if cfg.AdminToken != "token" {
		t.Fatalf("expected admin token from env, got %q", cfg.AdminToken)
	}
	if cfg.DefaultRetentionDays != 14 {
		t.Fatalf("expected default retention 14, got %d", cfg.DefaultRetentionDays)
	}
	if cfg.BatchSize != 25 {
		t.Fatalf("expected batch size 25, got %d", cfg.BatchSize)
	}
	if cfg.MaxDocsPerRun != 75 {
		t.Fatalf("expected max docs per run 75, got %d", cfg.MaxDocsPerRun)
	}
	if cfg.Interval != 2*time.Hour {
		t.Fatalf("expected interval 2h, got %s", cfg.Interval)
	}
}

func TestLoadConfigInvalidEnvFallsBack(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("DOCUMENT_VERSION_CLEANUP_ENABLED", "not-bool")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_DRY_RUN", "not-bool")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED", "not-bool")
	t.Setenv("DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS", "0")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_BATCH_SIZE", "-1")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN", "nope")
	t.Setenv("DOCUMENT_VERSION_CLEANUP_INTERVAL", "0s")

	cfg := LoadConfig()

	if cfg.Enabled {
		t.Fatal("expected invalid enabled env to fall back to false")
	}
	if !cfg.DryRun {
		t.Fatal("expected invalid dry-run env to fall back to true")
	}
	if cfg.AdminEnabled {
		t.Fatal("expected invalid admin env to fall back to false")
	}
	if cfg.DefaultRetentionDays != 7 {
		t.Fatalf("expected default retention fallback 7, got %d", cfg.DefaultRetentionDays)
	}
	if cfg.BatchSize != 500 {
		t.Fatalf("expected batch size fallback 500, got %d", cfg.BatchSize)
	}
	if cfg.MaxDocsPerRun != 500 {
		t.Fatalf("expected max docs fallback 500, got %d", cfg.MaxDocsPerRun)
	}
	if cfg.Interval != 24*time.Hour {
		t.Fatalf("expected interval fallback 24h, got %s", cfg.Interval)
	}
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"DOCUMENT_VERSION_CLEANUP_ENABLED",
		"DOCUMENT_VERSION_CLEANUP_DRY_RUN",
		"DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED",
		"DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN",
		"DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS",
		"DOCUMENT_VERSION_CLEANUP_BATCH_SIZE",
		"DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN",
		"DOCUMENT_VERSION_CLEANUP_INTERVAL",
	} {
		t.Setenv(key, "")
	}
}
