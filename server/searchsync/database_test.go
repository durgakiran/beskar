package searchsync

import (
	"context"
	"strings"
	"testing"
)

func targetEnvironment(t *testing.T) {
	t.Helper()
	for key, value := range map[string]string{
		"SEARCH_SYNC_CAPTURE_ENABLED": "false", "SEARCH_SYNC_WORKER_ENABLED": "true",
		"SEARCH_SYNC_POLL_INTERVAL": "1s", "SEARCH_SYNC_TRANSACTION_TIMEOUT": "30s",
		"SEARCH_SYNC_BATCH_SIZE": "25", "SEARCH_SYNC_MAX_ATTEMPTS": "10",
		"SEARCH_SYNC_RETRY_INITIAL": "1s", "SEARCH_SYNC_RETRY_MAX": "5m",
		"PG_SEARCH_HOST": "search-postgres", "PG_SEARCH_PORT": "6543",
		"PG_SEARCH_DB": "search", "PG_SEARCH_USER": "search_writer",
		"PG_SEARCH_PASSWORD": `a b'c\d@:/?#%&`, "PG_SEARCH_SSLMODE": "disable",
		"PGSERVICE": "", "PGSERVICEFILE": "",
	} {
		t.Setenv(key, value)
	}
}

func TestTargetConfigUsesSearchEnvironment(t *testing.T) {
	targetEnvironment(t)
	// Source settings must not influence the target.
	t.Setenv("PG_HOST", "source-postgres")
	t.Setenv("PG_DB", "beskar")
	c, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	pool, err := c.Database.poolConfig()
	if err != nil {
		t.Fatal(err)
	}
	conn := pool.ConnConfig
	if conn.Host != "search-postgres" || conn.Port != 6543 || conn.Database != "search" || conn.User != "search_writer" || conn.Password != `a b'c\d@:/?#%&` || conn.TLSConfig != nil {
		t.Fatal("target connection settings did not round-trip")
	}
}

func TestTargetConfigRejectsMissingSettingsWhenNeeded(t *testing.T) {
	for _, name := range []string{"PG_SEARCH_HOST", "PG_SEARCH_PORT", "PG_SEARCH_DB", "PG_SEARCH_USER"} {
		t.Run(name, func(t *testing.T) {
			targetEnvironment(t)
			t.Setenv(name, "")
			if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), name) {
				t.Fatal("missing target setting was not identified")
			}
			// Source-only commands can run without a configured target.
			t.Setenv("SEARCH_SYNC_WORKER_ENABLED", "false")
			c, err := LoadConfig()
			if err != nil {
				t.Fatal(err)
			}
			pool, err := OpenTarget(context.Background(), c)
			if err != nil || pool != nil {
				t.Fatal("disabled worker attempted to configure the target")
			}
			// The CLI's explicit once/reconcile paths enable target access.
			c.WorkerEnabled = true
			if _, err := OpenTarget(context.Background(), c); err == nil {
				t.Fatal("explicit target access accepted missing configuration")
			}
		})
	}
}

func TestTargetConfigRejectsInvalidSettingsWithoutLeakingPassword(t *testing.T) {
	for _, name := range []string{"PG_SEARCH_PORT", "PG_SEARCH_SSLMODE"} {
		t.Run(name, func(t *testing.T) {
			targetEnvironment(t)
			t.Setenv(name, "invalid")
			_, err := LoadConfig()
			if err == nil || err.Error() != "invalid PG_SEARCH_* database configuration" {
				t.Fatal("expected sanitized target configuration error")
			}
		})
	}
}

func TestTargetConfigTLSAndPasswordlessAuthentication(t *testing.T) {
	targetEnvironment(t)
	t.Setenv("PG_SEARCH_PASSWORD", "")
	t.Setenv("PG_SEARCH_SSLMODE", "require")
	c, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	pool, err := c.Database.poolConfig()
	if err != nil {
		t.Fatal(err)
	}
	if pool.ConnConfig.TLSConfig == nil {
		t.Fatal("target TLS setting was not applied")
	}
}
