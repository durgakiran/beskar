package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestPhase3FilesystemAdapterProbe(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := NewFilesystemStore(root)
	if err != nil {
		t.Fatal(err)
	}
	key := WhiteboardAssetObjectKey(41, "a"+string(bytes.Repeat([]byte("b"), 63)))
	original := []byte("phase3-filesystem-object")

	for i := 0; i < 2; i++ {
		if err := store.Put(ctx, key, bytes.NewReader(original), int64(len(original)), "application/octet-stream"); err != nil {
			t.Fatal(err)
		}
	}
	reader, metadata, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	loaded, readErr := io.ReadAll(reader)
	_ = reader.Close()
	if readErr != nil || !bytes.Equal(loaded, original) || metadata.Size != int64(len(original)) {
		t.Fatalf("filesystem dedupe probe mismatch: size=%d err=%v", metadata.Size, readErr)
	}

	objectDirectory := filepath.Dir(filepath.Join(root, filepath.FromSlash(key)))
	if err := os.Chmod(objectDirectory, 0o500); err != nil {
		t.Fatal(err)
	}
	deleteErr := store.Delete(ctx, key)
	if err := os.Chmod(objectDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if deleteErr == nil {
		t.Fatal("read-only filesystem directory did not surface delete failure")
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("filesystem delete retry failed: %v", err)
	}

	exists, err := store.Exists(ctx, key)
	if err != nil || exists {
		t.Fatalf("filesystem object remained after retry: exists=%v err=%v", exists, err)
	}
	if err := store.Put(ctx, key, bytes.NewReader(original), int64(len(original)), "application/octet-stream"); err != nil {
		t.Fatalf("filesystem restore failed: %v", err)
	}
	restored, _, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	restoredBytes, err := io.ReadAll(restored)
	_ = restored.Close()
	if err != nil || !bytes.Equal(restoredBytes, original) {
		t.Fatalf("filesystem restored bytes mismatch: %v", err)
	}
}

func TestPhase3FilesystemAdapterRejectsInvalidAndInterruptedOperations(t *testing.T) {
	if _, err := NewFilesystemStore(" "); err == nil {
		t.Fatal("empty root must fail")
	}
	store, err := NewFilesystemStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for name, operation := range map[string]func() error{
		"put":    func() error { return store.Put(ctx, "asset", bytes.NewReader(nil), 0, "") },
		"get":    func() error { _, _, err := store.Get(ctx, "asset"); return err },
		"exists": func() error { _, err := store.Exists(ctx, "asset"); return err },
		"delete": func() error { return store.Delete(ctx, "asset") },
	} {
		if err := operation(); err == nil {
			t.Fatalf("cancelled %s must fail", name)
		}
	}
	for _, key := range []string{"", "..", "../escape", "/absolute"} {
		if err := store.Put(context.Background(), key, bytes.NewReader(nil), 0, ""); err == nil {
			t.Fatalf("invalid key %q passed", key)
		}
	}
	for name, operation := range map[string]func() error{
		"get invalid key":    func() error { _, _, err := store.Get(context.Background(), "../escape"); return err },
		"exists invalid key": func() error { _, err := store.Exists(context.Background(), "../escape"); return err },
		"delete invalid key": func() error { return store.Delete(context.Background(), "../escape") },
	} {
		if err := operation(); err == nil {
			t.Fatalf("%s must fail", name)
		}
	}
	rootFile := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(rootFile, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFilesystemStore(rootFile); err == nil {
		t.Fatal("file-backed root must fail")
	}
	blockingParent := filepath.Join(store.root, "blocked")
	if err := os.WriteFile(blockingParent, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(context.Background(), "blocked/object", bytes.NewReader(nil), 0, ""); err == nil {
		t.Fatal("object under file parent must fail")
	}
	if err := store.Put(context.Background(), "short", bytes.NewReader([]byte("x")), 2, ""); err == nil {
		t.Fatal("short body must fail")
	}
	if _, _, err := store.Get(context.Background(), "missing"); err == nil {
		t.Fatal("missing object get must fail")
	}
	if exists, err := store.Exists(context.Background(), "missing"); err != nil || exists {
		t.Fatalf("missing object exists=%v err=%v", exists, err)
	}
	if err := store.Delete(context.Background(), "missing"); err != nil {
		t.Fatalf("missing delete must be idempotent: %v", err)
	}
}
