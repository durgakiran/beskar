package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// An explicit URL takes precedence so operators can select a different source.
// Otherwise use the same PG_* variables supplied to the application container.
func loadSourceConfig() (*pgxpool.Config, error) {
	dsn := os.Getenv("DATABASE_URL")
	if strings.TrimSpace(dsn) == "" {
		for _, name := range []string{"PG_HOST", "PG_PORT", "PG_DB", "PG_USER"} {
			if os.Getenv(name) == "" {
				return nil, fmt.Errorf("set DATABASE_URL or configure PG_HOST, PG_PORT, PG_DB, and PG_USER (missing %s)", name)
			}
		}
		// pgx keyword values escape backslashes and single quotes. Quoting every
		// value preserves passwords containing spaces, URL characters, or quotes.
		escape := strings.NewReplacer(`\`, `\\`, `'`, `\'`)
		var parameters []string
		for _, field := range []struct{ key, env string }{
			{"host", "PG_HOST"}, {"port", "PG_PORT"}, {"dbname", "PG_DB"},
			{"user", "PG_USER"}, {"password", "PG_PASSWORD"},
		} {
			parameters = append(parameters, field.key+"='"+escape.Replace(os.Getenv(field.env))+"'")
		}
		dsn = strings.Join(parameters, " ")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		// Parser errors can contain the DSN; keep credentials out of diagnostics.
		return nil, fmt.Errorf("invalid source database configuration")
	}
	return config, nil
}
