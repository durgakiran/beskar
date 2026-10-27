package main

import (
	"strings"
	"testing"
)

func sourceEnvironment(t *testing.T) {
	t.Helper()
	for name, value := range map[string]string{
		"DATABASE_URL": "", "PG_HOST": "postgres", "PG_PORT": "5432",
		"PG_DB": "beskar", "PG_USER": "app_user", "PG_PASSWORD": "secret",
		"PGSERVICE": "", "PGSERVICEFILE": "", "PGSSLMODE": "disable",
	} {
		t.Setenv(name, value)
	}
}

func TestSourceConfigUsesContainerSettings(t *testing.T) {
	sourceEnvironment(t)
	password := `a b'c\d@:/?#%&`
	t.Setenv("PG_PASSWORD", password)
	t.Setenv("PG_PORT", "6543")
	config, err := loadSourceConfig()
	if err != nil {
		t.Fatal(err)
	}
	conn := config.ConnConfig
	if conn.Host != "postgres" || conn.Port != 6543 || conn.Database != "beskar" || conn.User != "app_user" || conn.Password != password {
		t.Fatal("source settings did not round-trip")
	}
}

func TestSourceURLTakesPrecedence(t *testing.T) {
	sourceEnvironment(t)
	t.Setenv("DATABASE_URL", "postgres://operator:override@source.example:6544/other?sslmode=disable")
	t.Setenv("PG_PORT", "invalid")
	config, err := loadSourceConfig()
	if err != nil {
		t.Fatal(err)
	}
	conn := config.ConnConfig
	if conn.Host != "source.example" || conn.Port != 6544 || conn.Database != "other" || conn.User != "operator" || conn.Password != "override" {
		t.Fatal("DATABASE_URL did not override PG_* settings")
	}
}

func TestSourceConfigRejectsMissingSettings(t *testing.T) {
	for _, name := range []string{"PG_HOST", "PG_PORT", "PG_DB", "PG_USER"} {
		t.Run(name, func(t *testing.T) {
			sourceEnvironment(t)
			t.Setenv(name, "")
			_, err := loadSourceConfig()
			if err == nil || !strings.Contains(err.Error(), "missing "+name) {
				t.Fatal("missing source setting was not identified")
			}
		})
	}
}

func TestSourceConfigErrorsDoNotExposeCredentials(t *testing.T) {
	for _, useURL := range []bool{false, true} {
		sourceEnvironment(t)
		t.Setenv("PG_PASSWORD", "private-password")
		if useURL {
			t.Setenv("DATABASE_URL", "postgres://operator:private-password@host:invalid/beskar")
		} else {
			t.Setenv("PG_PORT", "invalid")
		}
		_, err := loadSourceConfig()
		if err == nil || err.Error() != "invalid source database configuration" {
			t.Fatal("expected a sanitized source configuration error")
		}
	}
}

func TestSourceConfigAllowsPasswordlessAuthentication(t *testing.T) {
	sourceEnvironment(t)
	t.Setenv("PG_PASSWORD", "")
	if _, err := loadSourceConfig(); err != nil {
		t.Fatal(err)
	}
}
