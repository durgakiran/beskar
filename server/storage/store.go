package storage

import (
	"context"
	"io"
	"sync"
)

// BlobMetadata captures object metadata returned by the store.
type BlobMetadata struct {
	Size        int64
	ContentType string
}

// Store is the storage interface used by uploads and migration tooling.
type Store interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, BlobMetadata, error)
	Exists(ctx context.Context, key string) (bool, error)
	Delete(ctx context.Context, key string) error
}

var (
	once    sync.Once
	runtime Store
	rtErr   error
)

// RuntimeStore returns the singleton bucket-backed store configured via environment variables.
func RuntimeStore(ctx context.Context) (Store, error) {
	once.Do(func() {
		cfg, err := LoadConfigFromEnv()
		if err != nil {
			rtErr = err
			return
		}
		runtime, rtErr = NewS3Store(ctx, cfg)
	})
	return runtime, rtErr
}

// ResetForTest clears the runtime singleton for tests that need isolated environment setup.
func ResetForTest() {
	once = sync.Once{}
	runtime = nil
	rtErr = nil
}
