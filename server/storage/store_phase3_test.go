package storage

import (
	"context"
	"testing"
)

func TestPhase3RuntimeStoreCachesSuccessAndFailure(t *testing.T) {
	ResetForTest()
	t.Cleanup(ResetForTest)
	for _, key := range []string{envBucket, envEndpoint, envRegion, envAccessKeyID, envSecretAccessKey} {
		t.Setenv(key, "")
	}
	if _, err := RuntimeStore(context.Background()); err == nil {
		t.Fatal("missing runtime storage config must fail")
	}
	if _, err := RuntimeStore(context.Background()); err == nil {
		t.Fatal("cached runtime storage config failure must remain visible")
	}

	ResetForTest()
	t.Setenv(envBucket, "phase3")
	t.Setenv(envEndpoint, "http://127.0.0.1:9000")
	t.Setenv(envRegion, "phase3")
	t.Setenv(envAccessKeyID, "key")
	t.Setenv(envSecretAccessKey, "secret")
	first, err := RuntimeStore(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := RuntimeStore(context.Background())
	if err != nil || first != second {
		t.Fatalf("runtime store singleton mismatch: %v", err)
	}
}
