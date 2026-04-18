package core

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const defaultUploadStorageDir = "public"

func UploadStorageDir() string {
	raw := strings.TrimSpace(os.Getenv("UPLOAD_STORAGE_DIR"))
	if raw == "" {
		return defaultUploadStorageDir
	}

	cleaned := filepath.Clean(raw)
	if cleaned == "" {
		return defaultUploadStorageDir
	}

	return cleaned
}

func ImageStorageDir() string {
	return filepath.Join(UploadStorageDir(), "images")
}

func AttachmentStorageDir() string {
	return filepath.Join(UploadStorageDir(), "attachments")
}

func AttachmentStoragePath(name string) string {
	return path.Join("attachments", name)
}

func ResolveUploadPath(relativePath string) (string, error) {
	norm, err := normalizeUploadRelativePath(relativePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(UploadStorageDir(), filepath.FromSlash(norm)), nil
}

func ResolveLegacyPublicUploadPath(relativePath string) (string, error) {
	norm, err := normalizeUploadRelativePath(relativePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(defaultUploadStorageDir, filepath.FromSlash(norm)), nil
}

func NormalizeAttachmentStoragePath(storagePath string) (string, error) {
	norm := strings.ReplaceAll(strings.TrimSpace(storagePath), "\\", "/")
	if norm == "" {
		return "", fs.ErrNotExist
	}

	cleaned := path.Clean(norm)
	currentRoot := path.Clean(strings.ReplaceAll(UploadStorageDir(), "\\", "/"))
	if currentRoot != "." && currentRoot != "" && strings.HasPrefix(cleaned, currentRoot+"/attachments/") {
		return strings.TrimPrefix(cleaned, currentRoot+"/"), nil
	}

	switch {
	case cleaned == ".", cleaned == "..", strings.HasPrefix(cleaned, "../"), strings.Contains(cleaned, "/../"):
		return "", fs.ErrNotExist
	case strings.HasPrefix(cleaned, "/"):
		return "", fs.ErrNotExist
	case strings.HasPrefix(cleaned, "attachments/"):
		return cleaned, nil
	case strings.HasPrefix(cleaned, defaultUploadStorageDir+"/attachments/"):
		return strings.TrimPrefix(cleaned, defaultUploadStorageDir+"/"), nil
	}

	return "", fs.ErrNotExist
}

func normalizeUploadRelativePath(relativePath string) (string, error) {
	norm := strings.ReplaceAll(strings.TrimSpace(relativePath), "\\", "/")
	if norm == "" {
		return "", errors.New("upload path is empty")
	}

	cleaned := path.Clean(norm)
	switch {
	case cleaned == ".", cleaned == "..", strings.HasPrefix(cleaned, "../"), strings.Contains(cleaned, "/../"):
		return "", errors.New("upload path is invalid")
	case strings.HasPrefix(cleaned, "/"):
		return "", errors.New("upload path must be relative")
	default:
		return cleaned, nil
	}
}
