package searchsync

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DatabaseConfig holds the separate search target's connection settings.
type DatabaseConfig struct {
	Host, Port, Name, User, Password, SSLMode string
}

func (c DatabaseConfig) poolConfig() (*pgxpool.Config, error) {
	fields := []struct{ key, env, value string }{
		{"host", "PG_SEARCH_HOST", c.Host}, {"port", "PG_SEARCH_PORT", c.Port},
		{"dbname", "PG_SEARCH_DB", c.Name}, {"user", "PG_SEARCH_USER", c.User},
	}
	escape := strings.NewReplacer(`\`, `\\`, `'`, `\'`)
	var parameters []string
	for _, field := range fields {
		if field.value == "" {
			return nil, fmt.Errorf("%s is required for search target access", field.env)
		}
		parameters = append(parameters, field.key+"='"+escape.Replace(field.value)+"'")
	}
	parameters = append(parameters, "password='"+escape.Replace(c.Password)+"'")
	if c.SSLMode != "" {
		parameters = append(parameters, "sslmode='"+escape.Replace(c.SSLMode)+"'")
	}
	config, err := pgxpool.ParseConfig(strings.Join(parameters, " "))
	if err != nil {
		return nil, fmt.Errorf("invalid PG_SEARCH_* database configuration")
	}
	return config, nil
}

// OpenTarget does not provision databases, extensions or schema. Keep migration
// privileges separate from runtime credentials. Disabled workers never connect.
func OpenTarget(ctx context.Context, c Config) (*pgxpool.Pool, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	if !c.WorkerEnabled {
		return nil, nil
	}
	return OpenTargetDatabase(ctx, c.Database)
}

// OpenTargetDatabase always configures a target pool. The application uses it
// for search queries regardless of the background worker's enablement.
func OpenTargetDatabase(ctx context.Context, c DatabaseConfig) (*pgxpool.Pool, error) {
	cfg, err := c.poolConfig()
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 2
	cfg.MinConns = 0
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create search target pool failed")
	}
	return pool, nil
}
