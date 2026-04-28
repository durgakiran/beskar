package storage

import "testing"

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv(envBucket, "bucket")
	t.Setenv(envEndpoint, "https://s3.example.com")
	t.Setenv(envRegion, "ap-southeast-1")
	t.Setenv(envAccessKeyID, "key")
	t.Setenv(envSecretAccessKey, "secret")
	t.Setenv(envPrefix, "/beskar-dev/uploads/")
	t.Setenv(envBaseURL, "https://cdn.example.com")

	cfg, err := LoadConfigFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Bucket != "bucket" {
		t.Fatalf("unexpected bucket: %q", cfg.Bucket)
	}
	if cfg.Endpoint != "https://s3.example.com" {
		t.Fatalf("unexpected endpoint: %q", cfg.Endpoint)
	}
	if cfg.Region != "ap-southeast-1" {
		t.Fatalf("unexpected region: %q", cfg.Region)
	}
	if cfg.AccessKeyID != "key" {
		t.Fatalf("unexpected access key id: %q", cfg.AccessKeyID)
	}
	if cfg.SecretAccessKey != "secret" {
		t.Fatalf("unexpected secret access key: %q", cfg.SecretAccessKey)
	}
	if cfg.Prefix != "beskar-dev/uploads" {
		t.Fatalf("unexpected prefix: %q", cfg.Prefix)
	}
	if cfg.BaseURL != "https://cdn.example.com" {
		t.Fatalf("unexpected base url: %q", cfg.BaseURL)
	}
}

func TestLoadConfigFromEnvMissingValues(t *testing.T) {
	t.Setenv(envBucket, "")
	t.Setenv(envEndpoint, "")
	t.Setenv(envRegion, "")
	t.Setenv(envAccessKeyID, "")
	t.Setenv(envSecretAccessKey, "")

	if _, err := LoadConfigFromEnv(); err == nil {
		t.Fatal("expected error for missing configuration")
	}
}

func TestNormalizePrefix(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty", in: "", want: ""},
		{name: "spaces", in: "   ", want: ""},
		{name: "simple", in: "beskar-dev", want: "beskar-dev"},
		{name: "trim slashes", in: "/beskar-dev/uploads/", want: "beskar-dev/uploads"},
		{name: "clean dots", in: "foo/../bar/uploads", want: "bar/uploads"},
		{name: "dot", in: ".", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizePrefix(tt.in); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}
