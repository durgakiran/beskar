package editor

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/google/uuid"
)

const (
	whiteboardAssetMaxBytes         = 20 * 1024 * 1024
	whiteboardAssetPrepareMaxBytes  = 16 * 1024
	whiteboardAssetUploadTTL        = 30 * time.Minute
	whiteboardAssetWriteTimeout     = time.Minute
	whiteboardAssetWriteLease       = 3 * time.Minute
	whiteboardAssetWriteGrace       = time.Minute
	whiteboardAssetInspectorVersion = 2
)

var (
	errWhiteboardAssetInvalid     = errors.New("invalid whiteboard asset content or metadata")
	errWhiteboardAssetNotFound    = errors.New("whiteboard asset or upload not found")
	errWhiteboardAssetNotReady    = errors.New("whiteboard asset is not ready")
	errWhiteboardAssetExpired     = errors.New("whiteboard asset upload expired")
	errWhiteboardAssetConflict    = errors.New("whiteboard asset upload cannot accept this operation")
	errWhiteboardAssetTooLarge    = errors.New("whiteboard asset exceeds size or pixel limits")
	errWhiteboardAssetUnsupported = errors.New("unsupported whiteboard asset media type")
	errWhiteboardAssetUnavailable = errors.New("whiteboard asset storage is unavailable")
	errWhiteboardAssetBusy        = errors.New("whiteboard asset operation is busy; retry later")
)

type whiteboardAssetPrepareInput struct {
	whiteboardDraftInput
	ContentHash    string    `json:"contentHash"`
	ContentType    string    `json:"contentType"`
	ByteLength     int64     `json:"byteLength"`
	IdempotencyKey uuid.UUID `json:"-"`
}

type whiteboardAssetDescriptor struct {
	ID          string `json:"id"`
	PageID      int64  `json:"pageId"`
	ContentHash string `json:"contentHash"`
	ContentType string `json:"contentType"`
	ByteLength  int64  `json:"byteLength"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	DownloadURL string `json:"downloadUrl"`
}

type whiteboardAssetUploadResult struct {
	UploadID       uuid.UUID                  `json:"uploadId"`
	State          string                     `json:"state"`
	ExpiresAt      time.Time                  `json:"expiresAt"`
	UploadURL      string                     `json:"uploadUrl"`
	StatusURL      string                     `json:"statusUrl"`
	CommitURL      string                     `json:"commitUrl"`
	Asset          *whiteboardAssetDescriptor `json:"asset,omitempty"`
	Retained       bool                       `json:"retained,omitempty"`
	CleanupPending bool                       `json:"cleanupPending,omitempty"`
}

type whiteboardAssetContent struct {
	Content     io.ReadSeekCloser
	Length      int64
	Digest      string
	ContentType string
}

type whiteboardAssetAPI interface {
	PrepareAsset(context.Context, whiteboardAssetPrepareInput) (whiteboardAssetUploadResult, error)
	StageAsset(context.Context, whiteboardDraftInput, uuid.UUID, string, []byte) (whiteboardAssetUploadResult, error)
	CommitAsset(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardAssetUploadResult, error)
	GetAssetUpload(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardAssetUploadResult, error)
	CancelAsset(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardAssetUploadResult, error)
	OpenAsset(context.Context, whiteboardDraftInput, string, *uuid.UUID) (whiteboardAssetContent, error)
}
