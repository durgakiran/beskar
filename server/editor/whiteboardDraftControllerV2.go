package editor

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type whiteboardDraftControllerV2 struct {
	user    func(context.Context) (core.UserInfo, error)
	canEdit func(string, uuid.UUID, string) bool
	service whiteboardDraftReader
}

func (deps whiteboardDraftControllerV2) register(r chi.Router) {
	r.Get("/space/{spaceId}/whiteboard/{pageId}/draft", deps.handleManifest)
	r.Get("/space/{spaceId}/whiteboard/{pageId}/draft/updates", deps.handleUpdates)
	r.Get("/space/{spaceId}/whiteboard/{pageId}/snapshots/{snapshotId}/content", deps.handleSnapshot)
	r.Head("/space/{spaceId}/whiteboard/{pageId}/snapshots/{snapshotId}/content", deps.handleSnapshot)
}
func (deps whiteboardDraftControllerV2) identity(w http.ResponseWriter, r *http.Request) (whiteboardDraftInput, bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	user, err := deps.user(r.Context())
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
	if !deps.canEdit(strconv.FormatInt(page, 10), actor, "edit") {
		whiteboardV2Error(w, r, 403, "DRAFT_FORBIDDEN", "You cannot read this whiteboard draft.")
		return whiteboardDraftInput{}, false
	}
	return whiteboardDraftInput{SpaceID: space, PageID: page, ActorID: actor}, true
}
func draftHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, errWhiteboardDraftCursor):
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Invalid draft cursor.")
	case errors.Is(err, errWhiteboardV2BoardNotFound):
		whiteboardV2Error(w, r, 404, "WHITEBOARD_NOT_FOUND", "Whiteboard or snapshot not found in this space.")
	case errors.Is(err, errWhiteboardDraftExpired):
		whiteboardV2Error(w, r, 410, "DRAFT_REPLAY_EXPIRED", "Replay expired or unavailable. Request a new draft manifest.")
	case errors.Is(err, errWhiteboardV2LockTimeout) || (errors.As(err, &pgErr) && pgErr.Code == "55P03"):
		w.Header().Set("Retry-After", "1")
		whiteboardV2Error(w, r, 503, "WHITEBOARD_DRAFT_BUSY", "Draft is busy. Retry the request.")
	default:
		logWhiteboardV2Error("whiteboard v2 draft read failed", err)
		whiteboardV2Error(w, r, 500, "WHITEBOARD_DRAFT_READ_FAILED", "Unable to read the complete draft.")
	}
}
func (deps whiteboardDraftControllerV2) handleManifest(w http.ResponseWriter, r *http.Request) {
	in, ok := deps.identity(w, r)
	if !ok {
		return
	}
	if r.URL.RawQuery != "" {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Draft manifest does not accept query parameters.")
		return
	}
	result, err := deps.service.GetDraft(r.Context(), in)
	if err != nil {
		draftHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
func draftSingleQuery(r *http.Request, name string) (string, bool) {
	// ParseQuery errors must not be silently discarded (for example a bad escape).
	parsed, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(parsed) != 1 {
		return "", false
	}
	values := parsed[name]
	if len(values) != 1 || values[0] == "" {
		return "", false
	}
	return values[0], true
}
func (deps whiteboardDraftControllerV2) handleUpdates(w http.ResponseWriter, r *http.Request) {
	in, ok := deps.identity(w, r)
	if !ok {
		return
	}
	cursor, ok := draftSingleQuery(r, "cursor")
	if !ok || len(cursor) > 128 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One replay cursor is required.")
		return
	}
	result, err := deps.service.GetDraftUpdates(r.Context(), in, cursor)
	if err != nil {
		draftHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

// Track source failures because ServeContent cannot change the HTTP status after
// headers have been sent. Abort the transport rather than append JSON to bytes.
type draftTrackedReader struct {
	io.ReadSeeker
	err error
}

func (reader *draftTrackedReader) Read(p []byte) (int, error) {
	n, err := reader.ReadSeeker.Read(p)
	if err != nil && err != io.EOF {
		reader.err = err
	}
	return n, err
}
func (deps whiteboardDraftControllerV2) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	in, ok := deps.identity(w, r)
	if !ok {
		return
	}
	raw, ok := draftSingleQuery(r, "replay")
	replay, err := uuid.Parse(raw)
	snapshot, snapshotErr := uuid.Parse(chi.URLParam(r, "snapshotId"))
	if !ok || err != nil || replay == uuid.Nil || snapshotErr != nil || snapshot == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Valid snapshot and replay IDs are required.")
		return
	}
	stream, err := deps.service.OpenDraftSnapshot(r.Context(), in, snapshot, replay)
	if err != nil {
		draftHTTPError(w, r, err)
		return
	}
	defer stream.Content.Close()
	// Range only applies to GET; HEAD describes the complete representation.
	if r.Method == http.MethodHead {
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	// One range per request avoids multipart range amplification. ServeContent
	// implements suffix/open ranges, If-Range, HEAD, ETag and 416 responses.
	if strings.Contains(r.Header.Get("Range"), ",") {
		w.Header().Set("Content-Range", fmtDraftUnsatisfiedRange(stream.Length))
		whiteboardV2Error(w, r, 416, "INVALID_RANGE", "Only one byte range is supported.")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", strconv.Quote(stream.Digest))
	w.Header().Set("X-Accel-Buffering", "no")
	reader := &draftTrackedReader{ReadSeeker: stream.Content}
	http.ServeContent(draftDownloadWriter{w}, r, "snapshot.yjs", time.Time{}, reader)
	if reader.err != nil {
		logWhiteboardV2Error("whiteboard snapshot transfer failed", reader.err)
		panic(http.ErrAbortHandler)
	}
}
func fmtDraftUnsatisfiedRange(length int64) string { return "bytes */" + strconv.FormatInt(length, 10) }

// ServeContent clears cache headers for some standard HTTP errors. Draft data
// and error responses must remain non-cacheable on those paths too.
type draftDownloadWriter struct{ http.ResponseWriter }

func (w draftDownloadWriter) WriteHeader(status int) {
	w.Header().Set("Cache-Control", "no-store")
	w.ResponseWriter.WriteHeader(status)
}
func (w draftDownloadWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
