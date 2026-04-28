package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	_ "image/jpeg"
	_ "image/png"
)

var allowedImageMIMEs = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
}

type ImageAssetRecord struct {
	ID               string
	PageID           int64
	PublicName       string
	StorageKey       string
	OriginalFileName string
	FileSize         int64
	MimeType         string
	Width            int
	Height           int
	CreatedBy        string
}

func sanitizeImageBaseName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." {
		return "image"
	}

	base = strings.TrimSuffix(base, filepath.Ext(base))
	var b strings.Builder
	for _, r := range base {
		switch {
		case r < 32:
			continue
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_' || r == '.':
			b.WriteRune('-')
		}
	}

	cleaned := strings.Trim(b.String(), "-")
	if cleaned == "" {
		return "image"
	}
	if len(cleaned) > 120 {
		cleaned = cleaned[:120]
	}
	return cleaned
}

func detectImageMetadata(data []byte) (string, int, int, error) {
	if len(data) == 0 {
		return "", 0, 0, errors.New("image is empty")
	}

	sniffLen := 512
	if len(data) < sniffLen {
		sniffLen = len(data)
	}
	mimeType := http.DetectContentType(data[:sniffLen])
	if _, ok := allowedImageMIMEs[mimeType]; !ok {
		return "", 0, 0, fmt.Errorf("not a supported image type: %s", mimeType)
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", 0, 0, fmt.Errorf("failed to decode image: %w", err)
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return "", 0, 0, errors.New("image dimensions are invalid")
	}

	return mimeType, cfg.Width, cfg.Height, nil
}

func imagePublicName(originalName, mimeType string) string {
	base := sanitizeImageBaseName(originalName)
	ext := allowedImageMIMEs[mimeType]
	return fmt.Sprintf("%s-%s%s", base, uuid.NewString()[:8], ext)
}

func imageStorageName(mimeType string) string {
	return uuid.NewString() + allowedImageMIMEs[mimeType]
}

func SaveImageAsset(ctx context.Context, reservation quota.UploadReservation, pageID int64, createdBy, originalFilename string, data []byte) (*ImageAssetRecord, error) {
	mimeType, width, height, err := detectImageMetadata(data)
	if err != nil {
		return nil, err
	}

	originalName := filepath.Base(strings.TrimSpace(originalFilename))
	if originalName == "" || originalName == "." {
		originalName = "image" + allowedImageMIMEs[mimeType]
	}

	record := &ImageAssetRecord{
		PageID:           pageID,
		PublicName:       imagePublicName(originalName, mimeType),
		StorageKey:       blobstorage.ImageObjectKey(imageStorageName(mimeType)),
		OriginalFileName: originalName,
		FileSize:         int64(len(data)),
		MimeType:         mimeType,
		Width:            width,
		Height:           height,
		CreatedBy:        createdBy,
	}

	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, err
	}
	if err := store.Put(ctx, record.StorageKey, bytes.NewReader(data), record.FileSize, record.MimeType); err != nil {
		core.Logger.Error("image: upload blob: " + err.Error())
		return nil, fmt.Errorf("failed to store image")
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		if delErr := store.Delete(ctx, record.StorageKey); delErr != nil {
			core.Logger.Error("image: rollback blob delete: " + delErr.Error())
		}
		return nil, err
	}
	defer tx.Rollback(ctx)

	const q = `INSERT INTO core.image_asset
	(page_id, public_name, storage_key, original_file_name, file_size, mime_type, width, height, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id::text`
	err = tx.QueryRow(ctx, q,
		record.PageID,
		record.PublicName,
		record.StorageKey,
		record.OriginalFileName,
		record.FileSize,
		record.MimeType,
		record.Width,
		record.Height,
		record.CreatedBy,
	).Scan(&record.ID)
	if err != nil {
		if delErr := store.Delete(ctx, record.StorageKey); delErr != nil {
			core.Logger.Error("image: rollback blob delete: " + delErr.Error())
		}
		return nil, err
	}
	if err := quota.CommitUploadUsageTx(ctx, tx, reservation); err != nil {
		if delErr := store.Delete(ctx, record.StorageKey); delErr != nil {
			core.Logger.Error("image: rollback blob delete: " + delErr.Error())
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		if delErr := store.Delete(ctx, record.StorageKey); delErr != nil {
			core.Logger.Error("image: rollback blob delete: " + delErr.Error())
		}
		return nil, err
	}

	return record, nil
}

func GetImageAssetByPublicName(ctx context.Context, publicName string) (*ImageAssetRecord, error) {
	publicName = strings.TrimSpace(publicName)
	if publicName == "" || strings.Contains(publicName, "/") || strings.Contains(publicName, "\\") {
		return nil, nil
	}

	const q = `SELECT id::text, page_id, public_name, storage_key, original_file_name, file_size, mime_type, width, height, created_by
FROM core.image_asset
WHERE public_name = $1 AND deleted_at IS NULL`

	var record ImageAssetRecord
	err := core.GetPool().QueryRow(ctx, q, publicName).Scan(
		&record.ID,
		&record.PageID,
		&record.PublicName,
		&record.StorageKey,
		&record.OriginalFileName,
		&record.FileSize,
		&record.MimeType,
		&record.Width,
		&record.Height,
		&record.CreatedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func OpenImage(ctx context.Context, storageKey string) (io.ReadCloser, blobstorage.BlobMetadata, error) {
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, blobstorage.BlobMetadata{}, err
	}
	return store.Get(ctx, storageKey)
}
