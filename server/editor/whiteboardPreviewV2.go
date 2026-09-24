package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image/png"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const whiteboardPreviewMaxBytes = 4 * 1024 * 1024
const whiteboardPublishMaxBody = 6 * 1024 * 1024

var errWhiteboardPreviewInvalid = errors.New("preview must be a valid PNG up to 4 MiB, 4096 pixels per dimension, and 8 million pixels")
var errWhiteboardPreviewMissing = errors.New("this published version has no preview")

type whiteboardPreviewMetadata struct {
	URL         string `json:"url"`
	ContentType string `json:"contentType"`
	ByteLength  int    `json:"byteLength"`
	Digest      string `json:"digest"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}
type whiteboardPreview struct {
	Bytes         []byte
	Digest        string
	Width, Height int
}

func validateWhiteboardPreview(data []byte) (whiteboardPreview, error) {
	result := whiteboardPreview{}
	if len(data) == 0 || len(data) > whiteboardPreviewMaxBytes {
		return result, errWhiteboardPreviewInvalid
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 8000000 {
		return result, errWhiteboardPreviewInvalid
	}
	decoded, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return result, errWhiteboardPreviewInvalid
	}
	// Re-encode to retain only decoded pixels, excluding ancillary/trailing payloads.
	output := &whiteboardLimitedBuffer{limit: whiteboardPreviewMaxBytes}
	if err = png.Encode(output, decoded); err != nil {
		return result, errWhiteboardPreviewInvalid
	}
	result.Bytes = output.Bytes()
	result.Width = config.Width
	result.Height = config.Height
	result.Digest = fmt.Sprintf("sha256:%x", sha256.Sum256(result.Bytes))
	return result, nil
}

const whiteboardV2InsertPreview = `INSERT INTO whiteboard.whiteboard_version_preview(version_id,png_bytes,digest,width,height) VALUES($1,$2,$3,$4,$5)`
const whiteboardV2PreviewMetadata = `SELECT octet_length(png_bytes),digest,width,height FROM whiteboard.whiteboard_version_preview WHERE version_id=$1`
const whiteboardV2PreviewContent = `SELECT png_bytes,digest,width,height FROM whiteboard.whiteboard_version_preview WHERE version_id=$1`

func (service *whiteboardServiceV2) GetPublishedPreview(ctx context.Context, in whiteboardDraftInput) (whiteboardPreview, error) {
	tx, current, err := service.beginPublished(ctx, in)
	if err != nil {
		return whiteboardPreview{}, err
	}
	defer draftRollback(ctx, tx)
	if current == nil {
		return whiteboardPreview{}, errWhiteboardNotPublished
	}
	return readWhiteboardPreview(ctx, tx, *current)
}
func (service *whiteboardServiceV2) GetVersionPreview(ctx context.Context, in whiteboardDraftInput, version uuid.UUID) (whiteboardPreview, error) {
	tx, _, err := service.beginPublished(ctx, in)
	if err != nil {
		return whiteboardPreview{}, err
	}
	defer draftRollback(ctx, tx)
	// Enforce the version belongs to this board before reading its preview.
	var found uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM whiteboard.whiteboard_version WHERE page_id=$1 AND id=$2`, in.PageID, version).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return whiteboardPreview{}, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return whiteboardPreview{}, err
	}
	return readWhiteboardPreview(ctx, tx, version)
}
func readWhiteboardPreview(ctx context.Context, tx pgx.Tx, version uuid.UUID) (whiteboardPreview, error) {
	result := whiteboardPreview{}
	err := tx.QueryRow(ctx, whiteboardV2PreviewContent, version).Scan(&result.Bytes, &result.Digest, &result.Width, &result.Height)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errWhiteboardPreviewMissing
	}
	return result, err
}
