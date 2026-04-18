// Package services implements file persistence and DB metadata for page attachments.
//
// Lifecycle policy: blobs are not deleted when an inline chip is removed from a document.
// The app does not call a delete endpoint on chip removal. Orphan blobs (no document
// reference to the attachment id) are removed by a scheduled cleanup job (see cleanup.go).
// This avoids breaking undo: if the user removes a chip and restores it, the file still exists.
package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AttachmentRecord is a row from core.attachment (active rows have deleted_at NULL).
type AttachmentRecord struct {
	ID          string
	PageID      int64
	StoragePath string
	FileName    string
	FileSize    int64
	MimeType    string
	CreatedBy   string
}

func ensureAttachmentsDir() error {
	return os.MkdirAll(core.AttachmentStorageDir(), 0o755)
}

// SanitizeDisplayName strips path segments and control characters for DB / Content-Disposition.
func SanitizeDisplayName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." {
		return "file"
	}
	var b strings.Builder
	for _, r := range base {
		if r < 32 {
			continue
		}
		switch r {
		case '"', '\\', '/', '<', '>', '|', ':', '*', '?':
			continue
		default:
			b.WriteRune(r)
		}
	}
	s := b.String()
	if s == "" {
		return "file"
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

func diskFileName(original string) string {
	ext := strings.ToLower(filepath.Ext(filepath.Base(original)))
	if ext == "" {
		ext = ".bin"
	}
	if len(ext) > 32 {
		ext = ".bin"
	}
	// Only allow simple extension chars
	for _, r := range ext[1:] {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '.' {
			ext = ".bin"
			break
		}
	}
	return uuid.New().String() + ext
}

// SaveAttachment writes bytes to disk and inserts core.attachment. Caller must enforce size and MIME.
func SaveAttachment(ctx context.Context, pageID int64, createdBy, originalFilename, mimeType string, data []byte) (*AttachmentRecord, error) {
	if len(data) > MaxAttachmentBytes {
		return nil, fmt.Errorf("file too large")
	}
	if !MimeAllowed(mimeType) {
		return nil, fmt.Errorf("mime type not allowed: %s", mimeType)
	}

	display := SanitizeDisplayName(originalFilename)
	onDisk := diskFileName(originalFilename)
	relPath := core.AttachmentStoragePath(onDisk)

	if err := ensureAttachmentsDir(); err != nil {
		return nil, err
	}

	fullPath, err := core.ResolveUploadPath(relPath)
	if err != nil {
		return nil, err
	}
	f, err := os.Create(fullPath)
	if err != nil {
		core.Logger.Error("attachment: create file: " + err.Error())
		return nil, fmt.Errorf("failed to store file")
	}
	_, werr := f.Write(data)
	cerr := f.Close()
	if werr != nil {
		_ = os.Remove(fullPath)
		return nil, werr
	}
	if cerr != nil {
		_ = os.Remove(fullPath)
		return nil, cerr
	}

	size := int64(len(data))
	pool := core.GetPool()
	var id string
	const q = `INSERT INTO core.attachment (page_id, storage_path, file_name, file_size, mime_type, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id::text`
	err = pool.QueryRow(ctx, q, pageID, relPath, display, size, mimeType, createdBy).Scan(&id)
	if err != nil {
		_ = os.Remove(fullPath)
		return nil, err
	}

	return &AttachmentRecord{
		ID:          id,
		PageID:      pageID,
		StoragePath: relPath,
		FileName:    display,
		FileSize:    size,
		MimeType:    mimeType,
		CreatedBy:   createdBy,
	}, nil
}

// GetAttachmentMeta returns metadata for an active (non-deleted) attachment.
func GetAttachmentMeta(ctx context.Context, id string) (*AttachmentRecord, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, nil
	}
	pool := core.GetPool()
	const q = `SELECT id::text, page_id, storage_path, file_name, file_size, mime_type, created_by
FROM core.attachment
WHERE id = $1::uuid AND deleted_at IS NULL`
	var rec AttachmentRecord
	err := pool.QueryRow(ctx, q, id).Scan(
		&rec.ID, &rec.PageID, &rec.StoragePath, &rec.FileName, &rec.FileSize, &rec.MimeType, &rec.CreatedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// ListAttachmentsForPage returns active attachments for a page in newest-first order.
func ListAttachmentsForPage(ctx context.Context, pageID int64) ([]AttachmentRecord, error) {
	pool := core.GetPool()
	const q = `SELECT id::text, page_id, storage_path, file_name, file_size, mime_type, created_by
FROM core.attachment
WHERE page_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC`

	rows, err := pool.Query(ctx, q, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (AttachmentRecord, error) {
		var rec AttachmentRecord
		err := row.Scan(&rec.ID, &rec.PageID, &rec.StoragePath, &rec.FileName, &rec.FileSize, &rec.MimeType, &rec.CreatedBy)
		return rec, err
	})
	if err != nil {
		return nil, err
	}

	return records, nil
}

// ReadAttachmentBytes loads file bytes from disk using storage_path relative to process cwd.
func ReadAttachmentBytes(storagePath string) ([]byte, error) {
	relPath, err := core.NormalizeAttachmentStoragePath(storagePath)
	if err != nil {
		return nil, err
	}

	fullPath, err := core.ResolveUploadPath(relPath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(fullPath)
	if err == nil {
		return data, nil
	}

	if !errors.Is(err, os.ErrNotExist) || core.UploadStorageDir() == "public" {
		return nil, err
	}

	legacyPath, legacyErr := core.ResolveLegacyPublicUploadPath(relPath)
	if legacyErr != nil {
		return nil, legacyErr
	}
	return os.ReadFile(legacyPath)
}
