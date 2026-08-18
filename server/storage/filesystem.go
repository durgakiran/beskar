package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// FilesystemStore is the migration and disaster-recovery adapter for bucket data on local disk.
type FilesystemStore struct {
	root string
}

func NewFilesystemStore(root string) (*FilesystemStore, error) {
	absolute, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil || strings.TrimSpace(root) == "" {
		return nil, errors.New("storage: filesystem root is required")
	}
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return nil, fmt.Errorf("storage: create filesystem root: %w", err)
	}
	return &FilesystemStore{root: absolute}, nil
}

func (s *FilesystemStore) objectPath(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(key)))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("storage: invalid filesystem object key")
	}
	objectPath := filepath.Join(s.root, clean)
	relative, err := filepath.Rel(s.root, objectPath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("storage: filesystem object escapes root")
	}
	return objectPath, nil
}

func (s *FilesystemStore) Put(ctx context.Context, key string, body io.Reader, size int64, _ string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	objectPath, err := s.objectPath(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(objectPath), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(objectPath), ".phase3-object-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	written, copyErr := io.Copy(temporary, io.LimitReader(body, size+1))
	closeErr := temporary.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != size {
		return fmt.Errorf("storage: expected %d bytes, received %d", size, written)
	}
	if err := os.Chmod(temporaryName, 0o600); err != nil {
		return err
	}
	return os.Rename(temporaryName, objectPath)
}

func (s *FilesystemStore) Get(ctx context.Context, key string) (io.ReadCloser, BlobMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, BlobMetadata{}, err
	}
	objectPath, err := s.objectPath(key)
	if err != nil {
		return nil, BlobMetadata{}, err
	}
	file, err := os.Open(objectPath)
	if err != nil {
		return nil, BlobMetadata{}, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, BlobMetadata{}, err
	}
	return file, BlobMetadata{Size: info.Size(), ContentType: "application/octet-stream"}, nil
}

func (s *FilesystemStore) Exists(ctx context.Context, key string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	objectPath, err := s.objectPath(key)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(objectPath)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func (s *FilesystemStore) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	objectPath, err := s.objectPath(key)
	if err != nil {
		return err
	}
	if err := os.Remove(objectPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
