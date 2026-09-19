package editor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type whiteboardPublishControllerV2 struct {
	user       func(context.Context) (core.UserInfo, error)
	permission func(string, uuid.UUID, string) bool
	service    whiteboardPublisherV2
}

func (d whiteboardPublishControllerV2) register(r chi.Router) {
	r.Post("/space/{spaceId}/whiteboard/{pageId}/publish", d.handlePublish)
	r.Get("/space/{spaceId}/whiteboard/{pageId}/published", d.handlePublished)
	r.Head("/space/{spaceId}/whiteboard/{pageId}/published", d.handlePublished)
	r.Get("/space/{spaceId}/whiteboard/{pageId}/published/{versionId}/preview", d.handlePreview)
	r.Head("/space/{spaceId}/whiteboard/{pageId}/published/{versionId}/preview", d.handlePreview)
	r.Get("/space/{spaceId}/whiteboard/{pageId}/published/{versionId}/content", d.handleContent)
	r.Head("/space/{spaceId}/whiteboard/{pageId}/published/{versionId}/content", d.handleContent)
}
func (d whiteboardPublishControllerV2) identity(w http.ResponseWriter, r *http.Request, permission string) (whiteboardDraftInput, bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	user, err := d.user(r.Context())
	actor, actorErr := uuid.Parse(user.AId)
	if err != nil || user.Id == "" || actorErr != nil || actor == uuid.Nil {
		whiteboardV2Error(w, r, 401, "UNAUTHENTICATED", "Authentication is required.")
		return whiteboardDraftInput{}, false
	}
	space, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	page, pageErr := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || space == uuid.Nil || pageErr != nil || page <= 0 || page > 9007199254740991 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Valid space and page IDs are required.")
		return whiteboardDraftInput{}, false
	}
	if !d.permission(strconv.FormatInt(page, 10), actor, permission) {
		whiteboardV2Error(w, r, 403, "WHITEBOARD_FORBIDDEN", "You cannot perform this whiteboard action.")
		return whiteboardDraftInput{}, false
	}
	if r.URL.RawQuery != "" && !validPublishedPreviewQuery(r) {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Query parameters are not supported.")
		return whiteboardDraftInput{}, false
	}
	return whiteboardDraftInput{SpaceID: space, PageID: page, ActorID: actor}, true
}
func validateWhiteboardPublish(data []byte) (int64, error) {
	var body struct {
		Sequence *string         `json:"sequence"`
		Preview  json.RawMessage `json:"preview"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || body.Sequence == nil || decoder.Decode(new(any)) != io.EOF {
		return 0, errors.New("One JSON object with a decimal string sequence is required.")
	}
	sequence, err := strconv.ParseInt(*body.Sequence, 10, 64)
	if err != nil || sequence < 0 || strconv.FormatInt(sequence, 10) != *body.Sequence {
		return 0, errors.New("sequence must be a canonical nonnegative int64 decimal string.")
	}
	return sequence, nil
}
func (d whiteboardPublishControllerV2) handlePublish(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity(w, r, "edit")
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
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardPublishMaxBody))
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "Publish request exceeds 6 MiB.")
		} else {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Unable to read request.")
		}
		return
	}
	sequence, err := validateWhiteboardPublish(data)
	if err != nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", err.Error())
		return
	}
	var body struct {
		Preview *struct {
			ContentType string `json:"contentType"`
			Data        []byte `json:"data"`
		} `json:"preview"`
	}
	if err = json.Unmarshal(data, &body); err != nil || body.Preview == nil || body.Preview.ContentType != "image/png" {
		whiteboardV2Error(w, r, 400, "INVALID_PREVIEW", "preview with contentType image/png and base64 data is required.")
		return
	}
	// The service fully decodes and normalizes PNG bytes before beginning its transaction.
	result, err := d.service.PublishWhiteboard(r.Context(), whiteboardPublishInput{whiteboardDraftInput: in, Sequence: sequence, IdempotencyKey: key, PreviewPNG: body.Preview.Data})
	if err != nil {
		publishHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
func (d whiteboardPublishControllerV2) handlePublished(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity(w, r, "view")
	if !ok {
		return
	}
	if r.URL.Query().Get("preview") == "true" {
		preview, err := d.service.GetPublishedPreview(r.Context(), in)
		if err != nil {
			publishHTTPError(w, r, err)
			return
		}
		serveWhiteboardPreview(w, r, preview)
		return
	}
	result, err := d.service.GetPublishedWhiteboard(r.Context(), in)
	if err != nil {
		publishHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, result)
}
func (d whiteboardPublishControllerV2) handleContent(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity(w, r, "view")
	if !ok {
		return
	}
	version, err := uuid.Parse(chi.URLParam(r, "versionId"))
	if err != nil || version == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid version UUID is required.")
		return
	}
	stream, err := d.service.OpenPublishedSnapshot(r.Context(), in, version)
	if err != nil {
		publishHTTPError(w, r, err)
		return
	}
	defer stream.Content.Close()
	if r.Method == http.MethodHead {
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	if strings.Contains(r.Header.Get("Range"), ",") {
		w.Header().Set("Content-Range", fmtDraftUnsatisfiedRange(stream.Length))
		whiteboardV2Error(w, r, 416, "INVALID_RANGE", "Only one byte range is supported.")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", strconv.Quote(stream.Digest))
	w.Header().Set("X-Accel-Buffering", "no")
	reader := &draftTrackedReader{ReadSeeker: stream.Content}
	http.ServeContent(draftDownloadWriter{w}, r, "published.yjs", time.Time{}, reader)
	if reader.err != nil {
		logWhiteboardV2Error("published snapshot transfer failed", reader.err)
		panic(http.ErrAbortHandler)
	}
}
func publishHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, errWhiteboardSnapshotAssetInvalid):
		whiteboardV2Error(w, r, 409, "ASSET_INVALID_REFERENCE", "The snapshot contains an invalid asset reference.")
	case errors.Is(err, errWhiteboardSnapshotAssetNotReady):
		whiteboardV2Error(w, r, 409, "ASSET_NOT_READY", "The snapshot references an asset that is not committed to this whiteboard.")
	case errors.Is(err, errWhiteboardPreviewInvalid):
		whiteboardV2Error(w, r, 400, "INVALID_PREVIEW", errWhiteboardPreviewInvalid.Error())
	case errors.Is(err, errWhiteboardPreviewMissing):
		whiteboardV2Error(w, r, 404, "WHITEBOARD_PREVIEW_NOT_FOUND", errWhiteboardPreviewMissing.Error())
	case errors.Is(err, errWhiteboardV2BoardNotFound):
		whiteboardV2Error(w, r, 404, "WHITEBOARD_NOT_FOUND", "Whiteboard or published version not found in this space.")
	case errors.Is(err, errWhiteboardNotPublished):
		whiteboardV2Error(w, r, 404, "WHITEBOARD_NOT_PUBLISHED", errWhiteboardNotPublished.Error())
	case errors.Is(err, errWhiteboardV2KeyReuse):
		whiteboardV2Error(w, r, 409, "IDEMPOTENCY_KEY_REUSED", errWhiteboardV2KeyReuse.Error())
	case errors.Is(err, errWhiteboardV2Archived):
		whiteboardV2Error(w, r, 409, "SPACE_ARCHIVED", errWhiteboardV2Archived.Error())
	case errors.Is(err, errWhiteboardPublishSequence):
		whiteboardV2Error(w, r, 409, "PUBLISH_SEQUENCE_UNAVAILABLE", errWhiteboardPublishSequence.Error())
	case errors.Is(err, errWhiteboardPublishState):
		whiteboardV2Error(w, r, 409, "PUBLISH_STATE_INVALID", errWhiteboardPublishState.Error())
	case errors.Is(err, errWhiteboardPublishLimit):
		whiteboardV2Error(w, r, 413, "PUBLISH_TOO_LARGE", errWhiteboardPublishLimit.Error())
	case errors.Is(err, errWhiteboardV2LockTimeout) || (errors.As(err, &pgErr) && pgErr.Code == "55P03"):
		w.Header().Set("Retry-After", "1")
		whiteboardV2Error(w, r, 503, "WHITEBOARD_PUBLISH_BUSY", "Whiteboard is busy. Retry with the same Idempotency-Key.")
	default:
		logWhiteboardV2Error("whiteboard v2 publication failed", err)
		whiteboardV2Error(w, r, 500, "WHITEBOARD_PUBLICATION_FAILED", "Unable to complete the request. Retry publish with the same Idempotency-Key.")
	}
}

func validPublishedPreviewQuery(r *http.Request) bool {
	if (r.Method != "GET" && r.Method != "HEAD") || !strings.HasSuffix(r.URL.Path, "/published") {
		return false
	}
	value, ok := draftSingleQuery(r, "preview")
	return ok && (value == "true" || value == "false")
}
func (d whiteboardPublishControllerV2) handlePreview(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity(w, r, "view")
	if !ok {
		return
	}
	version, err := uuid.Parse(chi.URLParam(r, "versionId"))
	if err != nil || version == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid version UUID is required.")
		return
	}
	preview, err := d.service.GetVersionPreview(r.Context(), in, version)
	if err != nil {
		publishHTTPError(w, r, err)
		return
	}
	serveWhiteboardPreview(w, r, preview)
}
func serveWhiteboardPreview(w http.ResponseWriter, r *http.Request, preview whiteboardPreview) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("ETag", strconv.Quote(preview.Digest))
	w.Header().Set("Content-Disposition", `inline; filename="whiteboard.png"`)
	if r.Method == http.MethodHead {
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	if strings.Contains(r.Header.Get("Range"), ",") {
		w.Header().Set("Content-Range", fmtDraftUnsatisfiedRange(int64(len(preview.Bytes))))
		whiteboardV2Error(w, r, 416, "INVALID_RANGE", "Only one byte range is supported.")
		return
	}
	http.ServeContent(draftDownloadWriter{w}, r, "whiteboard.png", time.Time{}, bytes.NewReader(preview.Bytes))
}
