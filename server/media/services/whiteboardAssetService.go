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
	"strconv"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	WhiteboardAssetInspectorVersion = 1
	MaxWhiteboardAssetBytes         = 20 * 1024 * 1024
	MaxWhiteboardAssetDimension     = 16_384
	MaxWhiteboardAssetPixels        = 64_000_000
)

var (
	ErrWhiteboardAssetNotFound    = errors.New("whiteboard asset not found")
	ErrWhiteboardAssetReferenced  = errors.New("whiteboard asset is retained by a document")
	ErrWhiteboardAssetNotOwner    = errors.New("whiteboard asset was created by another user")
	ErrWhiteboardAssetCompensated = errors.New("whiteboard asset staging transaction was compensated")
)

const whiteboardAssetReferenceCountQuery = `SELECT COUNT(*) FROM core.asset_reference
		WHERE asset_type = 'whiteboard_asset' AND page_id = $1 AND asset_id = $2`

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

type WhiteboardAssetStagingRecord struct {
	Token        uuid.UUID
	PageID       int64
	ContentHash  string
	StorageKey   string
	CreatedBy    string
	Status       string
	FileSize     int64
	MimeType     string
	Width        int
	Height       int
	Reservation  quota.UploadReservation
	CreatedAsset bool
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

func PrepareWhiteboardAssetStaging(ctx context.Context, pageID int64, contentHash, actorID string) (*WhiteboardAssetStagingRecord, error) {
	if pageID < 1 || !validContentHash(contentHash) || strings.TrimSpace(actorID) == "" {
		return nil, ErrWhiteboardAssetNotFound
	}
	record := &WhiteboardAssetStagingRecord{
		Token: uuid.New(), PageID: pageID, ContentHash: contentHash,
		StorageKey: blobstorage.WhiteboardAssetObjectKey(pageID, contentHash),
		CreatedBy:  actorID, Status: "prepared",
	}
	_, err := core.GetPool().Exec(ctx, `INSERT INTO core.whiteboard_asset_staging
		(token, page_id, content_hash, storage_key, created_by, status)
		VALUES ($1,$2,$3,$4,$5,'prepared')`,
		record.Token, record.PageID, record.ContentHash, record.StorageKey, record.CreatedBy)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func scanWhiteboardAssetStaging(row pgx.Row) (*WhiteboardAssetStagingRecord, error) {
	var record WhiteboardAssetStagingRecord
	var accountID, spaceID *uuid.UUID
	var correlationID *string
	err := row.Scan(&record.Token, &record.PageID, &record.ContentHash, &record.StorageKey,
		&record.CreatedBy, &record.Status, &record.FileSize, &record.MimeType,
		&record.Width, &record.Height, &accountID, &spaceID,
		&record.Reservation.ReservedBytes, &correlationID, &record.CreatedAsset)
	if err != nil {
		return nil, err
	}
	if accountID != nil {
		record.Reservation.AccountID = *accountID
	}
	if spaceID != nil {
		record.Reservation.SpaceID = *spaceID
	}
	if correlationID != nil {
		record.Reservation.CorrelationID = *correlationID
	}
	record.Reservation.SourceType = "whiteboard_asset_staging"
	record.Reservation.SourceID = record.Token.String()
	record.Reservation.Metadata = map[string]any{"pageId": record.PageID, "contentHash": record.ContentHash}
	return &record, nil
}

const whiteboardAssetStagingColumns = `token, page_id, content_hash, storage_key, created_by, status,
	file_size, COALESCE(mime_type, ''), COALESCE(width, 0), COALESCE(height, 0),
		quota_account_id, quota_space_id, quota_reserved_bytes, quota_correlation_id, created_asset`

func getWhiteboardAssetStagingForUpdate(ctx context.Context, tx pgx.Tx, token uuid.UUID) (*WhiteboardAssetStagingRecord, error) {
	record, err := scanWhiteboardAssetStaging(tx.QueryRow(ctx,
		`SELECT `+whiteboardAssetStagingColumns+` FROM core.whiteboard_asset_staging WHERE token = $1 FOR UPDATE`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWhiteboardAssetNotFound
	}
	return record, err
}

func validateStagingOwner(record *WhiteboardAssetStagingRecord, pageID int64, contentHash, actorID string) error {
	if record.PageID != pageID || record.ContentHash != contentHash {
		return ErrWhiteboardAssetNotFound
	}
	if record.CreatedBy != actorID {
		return ErrWhiteboardAssetNotOwner
	}
	return nil
}

func nullableUUID(value uuid.UUID) any {
	if value == uuid.Nil {
		return nil
	}
	return value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func lockWhiteboardAssetObject(ctx context.Context, tx pgx.Tx, pageID int64, contentHash string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		fmt.Sprintf("%d:%s", pageID, contentHash))
	return err
}

func StageWhiteboardAsset(ctx context.Context, token uuid.UUID, pageID int64, contentHash, actorID string, inspected InspectedRaster, data []byte) (*WhiteboardAssetStagingRecord, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	record, err := getWhiteboardAssetStagingForUpdate(ctx, tx, token)
	if err != nil {
		return nil, err
	}
	if err := validateStagingOwner(record, pageID, contentHash, actorID); err != nil {
		return nil, err
	}
	switch record.Status {
	case "committed", "compensated", "cancelled", "cleanup_pending", "durable_cleanup_pending":
		return nil, fmt.Errorf("whiteboard staging transaction is %s", record.Status)
	case "staged":
		if record.FileSize == inspected.FileSize && record.MimeType == inspected.MimeType && record.Width == inspected.Width && record.Height == inspected.Height {
			return record, nil
		}
		return nil, errors.New("staged bytes do not match the transaction")
	case "prepared":
		reservation, reserveErr := quota.ReserveUploadCapacityTx(ctx, tx, pageID, inspected.FileSize,
			"whiteboard_asset_staging", token.String(), map[string]any{"actorUserId": actorID, "contentHash": contentHash})
		if reserveErr != nil {
			return nil, reserveErr
		}
		record.Reservation = reservation
		record.FileSize, record.MimeType = inspected.FileSize, inspected.MimeType
		record.Width, record.Height = inspected.Width, inspected.Height
		_, err = tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='uploading', file_size=$2,
			mime_type=$3, width=$4, height=$5, quota_account_id=$6, quota_space_id=$7,
			quota_reserved_bytes=$8, quota_correlation_id=$9, updated_at=now() WHERE token=$1`,
			token, record.FileSize, record.MimeType, record.Width, record.Height,
			nullableUUID(reservation.AccountID), nullableUUID(reservation.SpaceID), reservation.ReservedBytes,
			nullableString(reservation.CorrelationID))
		if err != nil {
			return nil, err
		}
	case "uploading":
		if record.FileSize != inspected.FileSize || record.MimeType != inspected.MimeType || record.Width != inspected.Width || record.Height != inspected.Height {
			return nil, errors.New("upload retry does not match the transaction")
		}
	default:
		return nil, errors.New("invalid whiteboard staging status")
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	tx, err = core.GetPool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockWhiteboardAssetObject(ctx, tx, pageID, contentHash); err != nil {
		return nil, err
	}
	record, err = getWhiteboardAssetStagingForUpdate(ctx, tx, token)
	if err != nil {
		return nil, err
	}
	if record.Status == "staged" {
		return record, nil
	}
	if record.Status != "uploading" {
		return nil, fmt.Errorf("whiteboard staging transaction is %s", record.Status)
	}
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, err
	}
	exists, err := store.Exists(ctx, record.StorageKey)
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := store.Put(ctx, record.StorageKey, bytes.NewReader(data), inspected.FileSize, inspected.MimeType); err != nil {
			return nil, fmt.Errorf("failed to stage whiteboard asset: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='staged', updated_at=now() WHERE token=$1`, token); err != nil {
		return nil, err
	}
	record.Status = "staged"
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return record, nil
}

func CommitWhiteboardAssetStaging(ctx context.Context, token uuid.UUID, pageID int64, contentHash, actorID string) (*WhiteboardAssetRecord, bool, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	if err := lockWhiteboardAssetObject(ctx, tx, pageID, contentHash); err != nil {
		return nil, false, err
	}
	staging, err := getWhiteboardAssetStagingForUpdate(ctx, tx, token)
	if err != nil {
		return nil, false, err
	}
	if err := validateStagingOwner(staging, pageID, contentHash, actorID); err != nil {
		return nil, false, err
	}
	if staging.Status == "committed" {
		record, lookupErr := GetWhiteboardAsset(ctx, pageID, contentHash)
		if lookupErr == nil && record == nil {
			return nil, false, ErrWhiteboardAssetCompensated
		}
		return record, false, lookupErr
	}
	if staging.Status == "compensated" {
		return nil, false, ErrWhiteboardAssetCompensated
	}
	if staging.Status != "staged" {
		return nil, false, fmt.Errorf("whiteboard staging transaction is %s", staging.Status)
	}
	record := &WhiteboardAssetRecord{PageID: pageID, ContentHash: contentHash, StorageKey: staging.StorageKey,
		FileSize: staging.FileSize, MimeType: staging.MimeType, Width: staging.Width, Height: staging.Height,
		CreatedBy: actorID, Provenance: map[string]string{"source": "whiteboard-upload"}, InspectorVersion: WhiteboardAssetInspectorVersion}
	provenance, _ := json.Marshal(record.Provenance)
	tag, err := tx.Exec(ctx, `INSERT INTO core.whiteboard_asset
		(page_id, content_hash, storage_key, file_size, mime_type, width, height, created_by, provenance, inspector_version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (page_id, content_hash) DO NOTHING`,
		record.PageID, record.ContentHash, record.StorageKey, record.FileSize, record.MimeType,
		record.Width, record.Height, record.CreatedBy, provenance, record.InspectorVersion)
	if err != nil {
		return nil, false, err
	}
	created := tag.RowsAffected() == 1
	if created {
		err = quota.CommitUploadUsageTx(ctx, tx, staging.Reservation)
	} else {
		err = quota.ReleaseUploadReservationTx(ctx, tx, staging.Reservation)
	}
	if err != nil {
		return nil, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='committed',
		quota_reserved_bytes=0, created_asset=$2, updated_at=now() WHERE token=$1`, token, created)
	if err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	if !created {
		existing, lookupErr := GetWhiteboardAsset(ctx, pageID, contentHash)
		return existing, false, lookupErr
	}
	return record, true, nil
}

func CancelWhiteboardAssetStaging(ctx context.Context, token uuid.UUID, pageID int64, contentHash, actorID string) error {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	record, err := getWhiteboardAssetStagingForUpdate(ctx, tx, token)
	if err != nil {
		return err
	}
	if err := validateStagingOwner(record, pageID, contentHash, actorID); err != nil {
		return err
	}
	if record.Status == "cancelled" || record.Status == "compensated" {
		return tx.Commit(ctx)
	}
	if record.Status == "committed" {
		createdAsset := record.CreatedAsset
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		if !createdAsset {
			return nil
		}
		err := RollbackWhiteboardAsset(ctx, pageID, contentHash, actorID)
		if err != nil && !errors.Is(err, ErrWhiteboardAssetReferenced) && !errors.Is(err, ErrWhiteboardAssetNotFound) {
			return err
		}
		_, updateErr := core.GetPool().Exec(ctx, `UPDATE core.whiteboard_asset_staging
			SET status='compensated', quota_reserved_bytes=0, cleanup_error=NULL, next_cleanup_at=NULL, updated_at=now()
			WHERE token=$1 AND status='committed'`, token)
		return updateErr
	}
	if record.Status == "prepared" {
		_, err = tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='cancelled',
			cleanup_error=NULL, next_cleanup_at=NULL, updated_at=now() WHERE token=$1`, token)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging
		SET status='cleanup_pending', next_cleanup_at=now(), cleanup_error=NULL, updated_at=now() WHERE token=$1`, token); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	tx, err = core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockWhiteboardAssetObject(ctx, tx, pageID, contentHash); err != nil {
		return err
	}
	record, err = getWhiteboardAssetStagingForUpdate(ctx, tx, token)
	if err != nil {
		return err
	}
	var owners int
	err = tx.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM core.whiteboard_asset WHERE page_id=$1 AND content_hash=$2) +
		(SELECT COUNT(*) FROM core.whiteboard_asset_staging WHERE page_id=$1 AND content_hash=$2
		 AND token<>$3 AND status IN ('uploading','staged','cleanup_pending'))`, pageID, contentHash, token).Scan(&owners)
	if err != nil {
		return err
	}
	if owners == 0 {
		store, storeErr := blobstorage.RuntimeStore(ctx)
		if storeErr != nil {
			return storeErr
		}
		if deleteErr := store.Delete(ctx, record.StorageKey); deleteErr != nil {
			return fmt.Errorf("whiteboard staged blob cleanup failed: %w", deleteErr)
		}
	}
	if err := quota.ReleaseUploadReservationTx(ctx, tx, record.Reservation); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='cancelled', quota_reserved_bytes=0,
		cleanup_error=NULL, next_cleanup_at=NULL, updated_at=now() WHERE token=$1`, token)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func OpenWhiteboardAsset(ctx context.Context, storageKey string) (io.ReadCloser, blobstorage.BlobMetadata, error) {
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return nil, blobstorage.BlobMetadata{}, err
	}
	return store.Get(ctx, storageKey)
}

func RetainWhiteboardAssetReferences(ctx context.Context, pageID, docID int64, contentHashes []string) error {
	if pageID < 1 || docID < 1 {
		return errors.New("page and document ids are required")
	}
	unique := make(map[string]struct{}, len(contentHashes))
	for _, hash := range contentHashes {
		if !validContentHash(hash) {
			return errors.New("invalid whiteboard asset hash")
		}
		unique[hash] = struct{}{}
	}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var draft int
	if err := tx.QueryRow(ctx,
		`SELECT draft FROM core.page_doc_map WHERE page_id = $1 AND doc_id = $2`,
		pageID, docID,
	).Scan(&draft); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("document does not belong to the whiteboard page")
		}
		return err
	}
	sourceKind := "published_doc"
	if draft == 1 {
		sourceKind = "draft_doc"
	}
	for hash := range unique {
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM core.whiteboard_asset WHERE page_id = $1 AND content_hash = $2 FOR SHARE)`,
			pageID, hash,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrWhiteboardAssetNotFound
		}
		_, err := tx.Exec(ctx, `INSERT INTO core.asset_reference
			(asset_type, asset_id, page_id, doc_id, source_kind, source_id, last_seen_at, created_at, updated_at)
			VALUES ('whiteboard_asset', $1, $2, $3, $4, $5, now(), now(), now())
			ON CONFLICT (asset_type, asset_id, source_kind, source_id)
			DO UPDATE SET last_seen_at = now(), updated_at = now()`,
			hash, pageID, docID, sourceKind, strconv.FormatInt(docID, 10),
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// RollbackWhiteboardAsset preserves retry metadata and used quota until the
// unreferenced blob has actually been deleted.
func RollbackWhiteboardAsset(ctx context.Context, pageID int64, contentHash, actorID string) error {
	if pageID < 1 || !validContentHash(contentHash) || strings.TrimSpace(actorID) == "" {
		return ErrWhiteboardAssetNotFound
	}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var storageKey, createdBy, mimeType string
	var fileSize int64
	var width, height int
	err = tx.QueryRow(ctx, `SELECT storage_key, file_size, created_by, mime_type, width, height
		FROM core.whiteboard_asset WHERE page_id = $1 AND content_hash = $2 FOR UPDATE`,
		pageID, contentHash).Scan(&storageKey, &fileSize, &createdBy, &mimeType, &width, &height)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWhiteboardAssetNotFound
	}
	if err != nil {
		return err
	}
	if createdBy != actorID {
		return ErrWhiteboardAssetNotOwner
	}
	var references int
	if err := tx.QueryRow(ctx, whiteboardAssetReferenceCountQuery, pageID, contentHash).Scan(&references); err != nil {
		return err
	}
	if references > 0 {
		return ErrWhiteboardAssetReferenced
	}
	_, err = tx.Exec(ctx, `INSERT INTO core.whiteboard_asset_staging
		(token,page_id,content_hash,storage_key,created_by,status,file_size,mime_type,width,height)
		SELECT $1,$2,$3,$4,$5,'durable_cleanup_pending',$6,$7,$8,$9
		WHERE NOT EXISTS (SELECT 1 FROM core.whiteboard_asset_staging
		 WHERE page_id=$2 AND content_hash=$3 AND created_by=$5 AND status='durable_cleanup_pending')`,
		uuid.New(), pageID, contentHash, storageKey, actorID, fileSize, mimeType, width, height)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	tx, err = core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockWhiteboardAssetObject(ctx, tx, pageID, contentHash); err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `SELECT storage_key, file_size, created_by FROM core.whiteboard_asset
		WHERE page_id=$1 AND content_hash=$2 FOR UPDATE`, pageID, contentHash).Scan(&storageKey, &fileSize, &createdBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWhiteboardAssetNotFound
	}
	if err != nil {
		return err
	}
	if createdBy != actorID {
		return ErrWhiteboardAssetNotOwner
	}
	if err := tx.QueryRow(ctx, whiteboardAssetReferenceCountQuery, pageID, contentHash).Scan(&references); err != nil {
		return err
	}
	if references > 0 {
		return ErrWhiteboardAssetReferenced
	}
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		return err
	}
	if err := store.Delete(ctx, storageKey); err != nil {
		return fmt.Errorf("whiteboard durable blob cleanup failed: %w", err)
	}
	var spaceID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT space_id FROM core.page WHERE id=$1`, pageID).Scan(&spaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM core.whiteboard_asset WHERE page_id=$1 AND content_hash=$2`, pageID, contentHash); err != nil {
		return err
	}
	if err := quota.ApplyStorageUsageDeltaTx(ctx, tx, spaceID, -fileSize, "release", "whiteboard_asset_rollback", contentHash,
		map[string]any{"pageId": pageID, "contentHash": contentHash}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging SET status='cancelled', cleanup_error=NULL,
		next_cleanup_at=NULL, updated_at=now()
		WHERE page_id=$1 AND content_hash=$2 AND created_by=$3 AND status='durable_cleanup_pending'`, pageID, contentHash, actorID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE core.whiteboard_asset_staging
		SET status='compensated', quota_reserved_bytes=0, cleanup_error=NULL, next_cleanup_at=NULL, updated_at=now()
		WHERE page_id=$1 AND content_hash=$2 AND created_by=$3 AND status='committed' AND created_asset=true`, pageID, contentHash, actorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
