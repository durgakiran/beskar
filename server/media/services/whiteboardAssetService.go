package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/jackc/pgx/v5"
)

const (
	WhiteboardAssetInspectorVersion = 1
	MaxWhiteboardAssetBytes         = 20 * 1024 * 1024
	MaxWhiteboardAssetDimension     = 16_384
	MaxWhiteboardAssetPixels        = 64_000_000
)

type WhiteboardAssetRecord struct {
	PageID           int64
	ContentHash      string
	StorageKey       string
	FileSize         int64
	MimeType         string
	Width            int
	Height           int
	CreatedBy        string
	Provenance       map[string]string
	InspectorVersion int
}

type InspectedRaster struct {
	ContentHash string
	MimeType    string
	Width       int
	Height      int
	FileSize    int64
}

func validContentHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func sniffRasterMIME(data []byte) string {
	switch {
	case len(data) >= 24 &&
		bytes.Equal(data[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}) &&
		bytes.Equal(data[12:16], []byte("IHDR")):
		return "image/png"
	case len(data) >= 4 && data[0] == 0xff && data[1] == 0xd8:
		return "image/jpeg"
	case len(data) >= 30 && bytes.Equal(data[:4], []byte("RIFF")) &&
		bytes.Equal(data[8:12], []byte("WEBP")) && bytes.Equal(data[12:16], []byte("VP8X")):
		return "image/webp"
	default:
		return ""
	}
}

func webPExtendedDimensions(data []byte) (int, int, error) {
	if len(data) < 30 {
		return 0, 0, errors.New("WebP is truncated")
	}
	width := 1 + int(data[24]) + int(data[25])<<8 + int(data[26])<<16
	height := 1 + int(data[27]) + int(data[28])<<8 + int(data[29])<<16
	return width, height, nil
}

func validateWhiteboardRasterDimensions(width, height int) error {
	if width < 1 || height < 1 ||
		width > MaxWhiteboardAssetDimension || height > MaxWhiteboardAssetDimension ||
		int64(width)*int64(height) > MaxWhiteboardAssetPixels {
		return errors.New("raster exceeds decoded dimension or pixel limits")
	}
	return nil
}

// InspectWhiteboardRaster is the isolated data boundary used before storage or DB writes.
// It accepts bytes only: there is deliberately no remote-URL import path.
func InspectWhiteboardRaster(data []byte, declaredMIME, expectedHash string) (InspectedRaster, error) {
	if len(data) == 0 {
		return InspectedRaster{}, errors.New("whiteboard asset is empty")
	}
	if len(data) > MaxWhiteboardAssetBytes {
		return InspectedRaster{}, errors.New("whiteboard asset exceeds encoded byte limit")
	}
	mimeType := sniffRasterMIME(data)
	if mimeType == "" {
		return InspectedRaster{}, errors.New("unsupported or mismatched raster format")
	}
	if declaredMIME != "" && declaredMIME != mimeType {
		return InspectedRaster{}, errors.New("declared MIME type does not match raster bytes")
	}
	digest := sha256.Sum256(data)
	contentHash := hex.EncodeToString(digest[:])
	if !validContentHash(expectedHash) || contentHash != expectedHash {
		return InspectedRaster{}, errors.New("content hash does not match raster bytes")
	}

	var width, height int
	var err error
	if mimeType == "image/webp" {
		width, height, err = webPExtendedDimensions(data)
	} else {
		var config image.Config
		config, _, err = image.DecodeConfig(bytes.NewReader(data))
		width, height = config.Width, config.Height
	}
	if err != nil {
		return InspectedRaster{}, fmt.Errorf("failed to decode raster header: %w", err)
	}
	if err := validateWhiteboardRasterDimensions(width, height); err != nil {
		return InspectedRaster{}, err
	}
	return InspectedRaster{
		ContentHash: contentHash,
		MimeType:    mimeType,
		Width:       width,
		Height:      height,
		FileSize:    int64(len(data)),
	}, nil
}

func GetWhiteboardAsset(ctx context.Context, pageID int64, contentHash string) (*WhiteboardAssetRecord, error) {
	if pageID < 1 || !validContentHash(contentHash) {
		return nil, nil
	}
	const query = `SELECT page_id, content_hash, storage_key, file_size, mime_type, width, height,
created_by, provenance, inspector_version
FROM core.whiteboard_asset
WHERE page_id = $1 AND content_hash = $2`
	var record WhiteboardAssetRecord
	var provenance []byte
	err := core.GetPool().QueryRow(ctx, query, pageID, contentHash).Scan(
		&record.PageID, &record.ContentHash, &record.StorageKey, &record.FileSize,
		&record.MimeType, &record.Width, &record.Height, &record.CreatedBy,
		&provenance, &record.InspectorVersion,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(provenance) > 0 {
		_ = json.Unmarshal(provenance, &record.Provenance)
	}
	return &record, nil
}

// SaveWhiteboardAsset persists bytes before publishing their immutable catalog row.
// The caller releases the quota reservation when created is false or an error is returned.
func SaveWhiteboardAsset(
	ctx context.Context,
	reservation quota.UploadReservation,
	pageID int64,
	createdBy string,
	inspected InspectedRaster,
	data []byte,
) (record *WhiteboardAssetRecord, created bool, err error) {
	if existing, lookupErr := GetWhiteboardAsset(ctx, pageID, inspected.ContentHash); lookupErr != nil {
		return nil, false, lookupErr
	} else if existing != nil {
		return existing, false, nil
	}

	record = &WhiteboardAssetRecord{
		PageID:           pageID,
		ContentHash:      inspected.ContentHash,
		StorageKey:       blobstorage.WhiteboardAssetObjectKey(pageID, inspected.ContentHash),
		FileSize:         inspected.FileSize,
		MimeType:         inspected.MimeType,
		Width:            inspected.Width,
		Height:           inspected.Height,
		CreatedBy:        createdBy,
		Provenance:       map[string]string{"source": "whiteboard-upload"},
		InspectorVersion: WhiteboardAssetInspectorVersion,
	}
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, false, err
	}
	exists, err := store.Exists(ctx, record.StorageKey)
	if err != nil {
		return nil, false, err
	}
	if !exists {
		if err := store.Put(ctx, record.StorageKey, bytes.NewReader(data), record.FileSize, record.MimeType); err != nil {
			return nil, false, fmt.Errorf("failed to store whiteboard asset")
		}
	}

	provenance, _ := json.Marshal(record.Provenance)
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	const insert = `INSERT INTO core.whiteboard_asset
(page_id, content_hash, storage_key, file_size, mime_type, width, height, created_by, provenance, inspector_version)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (page_id, content_hash) DO NOTHING`
	tag, err := tx.Exec(ctx, insert,
		record.PageID, record.ContentHash, record.StorageKey, record.FileSize, record.MimeType,
		record.Width, record.Height, record.CreatedBy, provenance, record.InspectorVersion,
	)
	if err != nil {
		return nil, false, err
	}
	if tag.RowsAffected() == 0 {
		return record, false, tx.Commit(ctx)
	}
	if err := quota.CommitUploadUsageTx(ctx, tx, reservation); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return record, true, nil
}

func OpenWhiteboardAsset(ctx context.Context, storageKey string) (io.ReadCloser, blobstorage.BlobMetadata, error) {
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, blobstorage.BlobMetadata{}, err
	}
	return store.Get(ctx, storageKey)
}

func ListWhiteboardAssetStorageKeys(ctx context.Context, pageID int64) ([]string, error) {
	rows, err := core.GetPool().Query(ctx,
		`SELECT storage_key FROM core.whiteboard_asset WHERE page_id = $1 ORDER BY storage_key`,
		pageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func DeleteWhiteboardAssetObjects(ctx context.Context, storageKeys []string) error {
	if len(storageKeys) == 0 {
		return nil
	}
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, key := range storageKeys {
		if err := store.Delete(ctx, key); err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", key, err))
		}
	}
	return errors.Join(failures...)
}
