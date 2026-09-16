package editor

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type whiteboardAssetControllerV2 struct {
	identity whiteboardPublishControllerV2
	service  whiteboardAssetAPI
}

func (d whiteboardAssetControllerV2) register(r chi.Router) {
	base := "/space/{spaceId}/whiteboard/{pageId}"
	r.Post(base+"/assets/uploads", d.handlePrepare)
	r.Put(base+"/assets/uploads/{uploadId}/content", d.handleStage)
	r.Post(base+"/assets/uploads/{uploadId}/commit", d.handleCommit)
	r.Get(base+"/assets/uploads/{uploadId}", d.handleStatus)
	r.Delete(base+"/assets/uploads/{uploadId}", d.handleCancel)
	r.Get(base+"/assets/{contentHash}/content", d.handleContent)
	r.Head(base+"/assets/{contentHash}/content", d.handleContent)
	r.Get(base+"/published/{versionId}/assets/{contentHash}/content", d.handlePublishedContent)
	r.Head(base+"/published/{versionId}/assets/{contentHash}/content", d.handlePublishedContent)
}

func (d whiteboardAssetControllerV2) authorize(w http.ResponseWriter, r *http.Request, permission string) (whiteboardDraftInput, bool) {
	in, ok := d.identity.identity(w, r, permission)
	if !ok {
		return in, false
	}
	// The publication identity helper permits its preview query on one route.
	// Asset routes never take client-supplied query parameters.
	if r.URL.RawQuery != "" {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Asset routes do not accept query parameters.")
		return in, false
	}
	return in, true
}

func validWhiteboardAssetHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// Decode exact field names once: encoding/json's struct decoder otherwise accepts
// case variants and duplicate fields, which makes idempotency payloads ambiguous.
func validateWhiteboardAssetPrepare(data []byte) (whiteboardAssetPrepareInput, error) {
	var in whiteboardAssetPrepareInput
	d := json.NewDecoder(bytes.NewReader(data))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return in, errWhiteboardAssetInvalid
	}
	seen := make(map[string]bool, 3)
	for d.More() {
		token, err := d.Token()
		name, ok := token.(string)
		if err != nil || !ok || seen[name] {
			return in, errWhiteboardAssetInvalid
		}
		seen[name] = true
		switch name {
		case "contentHash":
			err = d.Decode(&in.ContentHash)
		case "contentType":
			err = d.Decode(&in.ContentType)
		case "byteLength":
			err = d.Decode(&in.ByteLength)
		default:
			return in, errWhiteboardAssetInvalid
		}
		if err != nil {
			return in, errWhiteboardAssetInvalid
		}
	}
	if _, err = d.Token(); err != nil || d.Decode(new(any)) != io.EOF || len(seen) != 3 ||
		!validWhiteboardAssetHash(in.ContentHash) || in.ByteLength <= 0 {
		return in, errWhiteboardAssetInvalid
	}
	if in.ByteLength > whiteboardAssetMaxBytes {
		return in, errWhiteboardAssetTooLarge
	}
	if !whiteboardAssetSupportedType(in.ContentType) {
		return in, errWhiteboardAssetUnsupported
	}
	return in, nil
}

func whiteboardAssetSupportedType(media string) bool {
	return media == "image/png" || media == "image/jpeg" || media == "image/webp"
}

func (d whiteboardAssetControllerV2) handlePrepare(w http.ResponseWriter, r *http.Request) {
	identity, ok := d.authorize(w, r, "edit")
	if !ok {
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	var key uuid.UUID
	var err error
	if len(keys) == 1 {
		key, err = uuid.Parse(keys[0])
	}
	if len(keys) != 1 || err != nil || key == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One UUID Idempotency-Key header is required.")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardAssetPrepareMaxBytes))
	if err != nil {
		whiteboardAssetBodyError(w, r, err)
		return
	}
	in, err := validateWhiteboardAssetPrepare(data)
	if err != nil {
		whiteboardAssetHTTPError(w, r, err)
		return
	}
	in.whiteboardDraftInput, in.IdempotencyKey = identity, key
	result, err := d.service.PrepareAsset(r.Context(), in)
	if err != nil {
		whiteboardAssetHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusCreated, result)
}

func (d whiteboardAssetControllerV2) uploadIdentity(w http.ResponseWriter, r *http.Request) (whiteboardDraftInput, uuid.UUID, bool) {
	in, ok := d.authorize(w, r, "edit")
	if !ok {
		return in, uuid.Nil, false
	}
	upload, err := uuid.Parse(chi.URLParam(r, "uploadId"))
	if err != nil || upload == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid upload UUID is required.")
		return in, uuid.Nil, false
	}
	return in, upload, true
}

func (d whiteboardAssetControllerV2) handleStage(w http.ResponseWriter, r *http.Request) {
	in, upload, ok := d.uploadIdentity(w, r)
	if !ok {
		return
	}
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || len(params) != 0 || !whiteboardAssetSupportedType(media) || r.Header.Get("Content-Encoding") != "" {
		whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "Raw PNG, JPEG, or WebP bytes with their image Content-Type are required.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardAssetMaxBytes))
	if err != nil {
		whiteboardAssetBodyError(w, r, err)
		return
	}
	if len(data) == 0 {
		whiteboardAssetHTTPError(w, r, errWhiteboardAssetInvalid)
		return
	}
	result, err := d.service.StageAsset(r.Context(), in, upload, media, data)
	if err != nil {
		whiteboardAssetHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func whiteboardAssetBodyError(w http.ResponseWriter, r *http.Request, err error) {
	var large *http.MaxBytesError
	if errors.As(err, &large) {
		whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "Asset request exceeds its body limit.")
	} else {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Unable to read the asset request.")
	}
}

func (d whiteboardAssetControllerV2) handleCommit(w http.ResponseWriter, r *http.Request) {
	d.handleSession(w, r, "commit")
}
func (d whiteboardAssetControllerV2) handleStatus(w http.ResponseWriter, r *http.Request) {
	d.handleSession(w, r, "status")
}
func (d whiteboardAssetControllerV2) handleCancel(w http.ResponseWriter, r *http.Request) {
	d.handleSession(w, r, "cancel")
}
func (d whiteboardAssetControllerV2) handleSession(w http.ResponseWriter, r *http.Request, action string) {
	in, upload, ok := d.uploadIdentity(w, r)
	if !ok {
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
	if err != nil || len(data) != 0 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "This asset operation does not accept a request body.")
		return
	}
	var result whiteboardAssetUploadResult
	switch action {
	case "commit":
		result, err = d.service.CommitAsset(r.Context(), in, upload)
	case "status":
		result, err = d.service.GetAssetUpload(r.Context(), in, upload)
	case "cancel":
		result, err = d.service.CancelAsset(r.Context(), in, upload)
	}
	if err != nil {
		whiteboardAssetHTTPError(w, r, err)
		return
	}
	status := http.StatusOK
	if action == "cancel" && result.CleanupPending {
		status = http.StatusAccepted
	}
	core.SendSuccessResponse(w, r, status, result)
}

func (d whiteboardAssetControllerV2) handleContent(w http.ResponseWriter, r *http.Request) {
	d.serveContent(w, r, false)
}
func (d whiteboardAssetControllerV2) handlePublishedContent(w http.ResponseWriter, r *http.Request) {
	d.serveContent(w, r, true)
}
func (d whiteboardAssetControllerV2) serveContent(w http.ResponseWriter, r *http.Request, published bool) {
	permission := "edit"
	if published {
		permission = "view"
	}
	in, ok := d.authorize(w, r, permission)
	if !ok {
		return
	}
	hash := chi.URLParam(r, "contentHash")
	if !validWhiteboardAssetHash(hash) {
		whiteboardAssetHTTPError(w, r, errWhiteboardAssetInvalid)
		return
	}
	var version *uuid.UUID
	if published {
		id, err := uuid.Parse(chi.URLParam(r, "versionId"))
		if err != nil || id == uuid.Nil {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid published version UUID is required.")
			return
		}
		version = &id
	}
	stream, err := d.service.OpenAsset(r.Context(), in, hash, version)
	if err != nil {
		whiteboardAssetHTTPError(w, r, err)
		return
	}
	if stream.Content == nil {
		whiteboardAssetHTTPError(w, r, errWhiteboardAssetUnavailable)
		return
	}
	defer stream.Content.Close()
	if !whiteboardAssetSupportedType(stream.ContentType) || stream.Digest != hash || stream.Length <= 0 {
		whiteboardAssetHTTPError(w, r, errWhiteboardAssetUnavailable)
		return
	}
	if r.Method == http.MethodHead {
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	if len(r.Header.Values("Range")) > 1 || strings.Contains(r.Header.Get("Range"), ",") {
		w.Header().Set("Content-Range", fmtDraftUnsatisfiedRange(stream.Length))
		whiteboardV2Error(w, r, 416, "INVALID_RANGE", "Only one byte range is supported.")
		return
	}
	w.Header().Set("Content-Type", stream.ContentType)
	w.Header().Set("ETag", strconv.Quote(stream.Digest))
	w.Header().Set("X-Accel-Buffering", "no")
	reader := &draftTrackedReader{ReadSeeker: stream.Content}
	http.ServeContent(draftDownloadWriter{w}, r, "whiteboard-asset", time.Time{}, reader)
	if reader.err != nil {
		logWhiteboardV2Error("whiteboard asset transfer failed", reader.err)
		panic(http.ErrAbortHandler)
	}
}

func whiteboardAssetHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, errWhiteboardAssetInvalid):
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Valid asset metadata and matching, decodable image bytes are required.")
	case errors.Is(err, errWhiteboardV2BoardNotFound):
		whiteboardV2Error(w, r, 404, "WHITEBOARD_NOT_FOUND", "Whiteboard not found in this space.")
	case errors.Is(err, errWhiteboardAssetNotFound):
		whiteboardV2Error(w, r, 404, "ASSET_NOT_FOUND", "Asset, upload, or published asset membership not found.")
	case errors.Is(err, errWhiteboardAssetNotReady):
		whiteboardV2Error(w, r, 409, "ASSET_NOT_READY", "The asset is not ready for this operation.")
	case errors.Is(err, errWhiteboardAssetExpired):
		whiteboardV2Error(w, r, 410, "ASSET_UPLOAD_EXPIRED", "This asset upload has expired.")
	case errors.Is(err, errWhiteboardAssetConflict):
		whiteboardV2Error(w, r, 409, "ASSET_UPLOAD_CONFLICT", "The asset upload cannot make this transition.")
	case errors.Is(err, errWhiteboardV2KeyReuse):
		whiteboardV2Error(w, r, 409, "IDEMPOTENCY_KEY_REUSED", "The upload key was already used with different metadata.")
	case errors.Is(err, errWhiteboardV2Archived):
		whiteboardV2Error(w, r, 409, "SPACE_ARCHIVED", "New asset work is unavailable in an archived space.")
	case errors.Is(err, quota.ErrAccountStorageLimitExceeded):
		whiteboardV2Error(w, r, 409, "ASSET_QUOTA_EXCEEDED", "Account storage quota is exhausted.")
	case errors.Is(err, errWhiteboardAssetTooLarge):
		whiteboardV2Error(w, r, 413, "ASSET_TOO_LARGE", "Image exceeds the encoded size or decoded dimension limits.")
	case errors.Is(err, errWhiteboardAssetUnsupported):
		whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "PNG, JPEG, and WebP images are supported.")
	case errors.Is(err, errWhiteboardAssetUnavailable):
		logWhiteboardV2Error("whiteboard asset content unavailable", err)
		w.Header().Set("Retry-After", "1")
		whiteboardV2Error(w, r, 503, "ASSET_CONTENT_UNAVAILABLE", "Asset storage is unavailable. Retry or inspect the upload status.")
	case errors.Is(err, errWhiteboardAssetBusy), errors.Is(err, errWhiteboardV2LockTimeout), errors.As(err, &pgErr) && (pgErr.Code == "55P03" || pgErr.Code == "40P01"):
		w.Header().Set("Retry-After", "1")
		whiteboardV2Error(w, r, 503, "ASSET_UPLOAD_BUSY", "Asset upload is busy. Retry or inspect the upload status.")
	default:
		logWhiteboardV2Error("whiteboard asset operation failed", err)
		whiteboardV2Error(w, r, 500, "ASSET_OPERATION_FAILED", "Asset operation could not be confirmed. Inspect the upload status before retrying.")
	}
}
