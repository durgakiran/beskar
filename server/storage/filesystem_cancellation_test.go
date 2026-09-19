package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

type cancelDuringFileCopy struct {
	reader *bytes.Reader
	cancel context.CancelFunc
}

func (r cancelDuringFileCopy) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.cancel()
	return n, err
}

func TestFilesystemCancelledCopyDoesNotPublishOrReplaceObject(t *testing.T) {
	store, err := NewFilesystemStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	original := []byte("confirmed")
	if err = store.Put(context.Background(), "existing", bytes.NewReader(original), int64(len(original)), "image/png"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"new", "existing"} {
		ctx, cancel := context.WithCancel(context.Background())
		data := []byte("cancelled replacement")
		err = store.Put(ctx, key, cancelDuringFileCopy{bytes.NewReader(data), cancel}, int64(len(data)), "image/png")
		cancel()
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled copy: %v", err)
		}
	}
	if exists, err := store.Exists(context.Background(), "new"); err != nil || exists {
		t.Fatalf("cancelled new object: %v %v", exists, err)
	}
	body, _, err := store.Get(context.Background(), "existing")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	got, err := io.ReadAll(body)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatalf("confirmed object changed: %q %v", got, err)
	}
}
