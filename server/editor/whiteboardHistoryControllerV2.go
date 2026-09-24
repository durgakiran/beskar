package editor

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
)

type whiteboardHistoryV2 interface {
	GetWhiteboardVersion(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardPublishedManifest, error)
	ListWhiteboardVersions(context.Context, whiteboardDraftInput, int64, int) (whiteboardVersionList, error)
	RestoreWhiteboardVersion(context.Context, whiteboardRestoreInput) (whiteboardRestoreResult, error)
	DeleteWhiteboardV2(context.Context, whiteboardDraftInput) error
}
type whiteboardHistoryControllerV2 struct {
	identity whiteboardPublishControllerV2
	service  whiteboardHistoryV2
}

func (d whiteboardHistoryControllerV2) register(r chi.Router) {
	root := "/space/{spaceId}/whiteboard/{pageId}"
	r.Delete(root, d.remove)
	r.Get(root+"/versions", d.list)
	r.Get(root+"/versions/{versionId}", d.get)
	r.Post(root+"/versions/{versionId}/restore", d.restore)
}
func historyError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errWhiteboardHeadChanged):
		whiteboardV2Error(w, r, 409, "DRAFT_HEAD_CHANGED", err.Error())
	case errors.Is(err, errWhiteboardHasChildren):
		whiteboardV2Error(w, r, 409, "WHITEBOARD_HAS_CHILDREN", err.Error())
	default:
		publishHTTPError(w, r, err)
	}
}
func (d whiteboardHistoryControllerV2) list(w http.ResponseWriter, r *http.Request) {
	// Identity parsing is shared, while only this endpoint accepts pagination.
	copyRequest := r.Clone(r.Context())
	copyURL := *r.URL
	copyURL.RawQuery = ""
	copyRequest.URL = &copyURL
	in, ok := d.identity.identity(w, copyRequest, "view")
	if !ok {
		return
	}
	query, err := urlQuery(r)
	if err != nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", err.Error())
		return
	}
	result, err := d.service.ListWhiteboardVersions(r.Context(), in, query[0], int(query[1]))
	if err != nil {
		historyError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, result)
}
func urlQuery(r *http.Request) ([2]int64, error) {
	out := [2]int64{0, 20}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return out, errors.New("Invalid pagination")
	}
	for key, values := range q {
		if (key != "before" && key != "limit") || len(values) != 1 {
			return out, errors.New("Use only before and limit once")
		}
		n, e := strconv.ParseInt(values[0], 10, 64)
		if e != nil || n <= 0 || strconv.FormatInt(n, 10) != values[0] {
			return out, errors.New("Pagination values must be positive decimal integers")
		}
		if key == "before" {
			out[0] = n
		} else {
			if n > 100 {
				return out, errors.New("limit must not exceed 100")
			}
			out[1] = n
		}
	}
	return out, nil
}
func historyVersion(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "versionId"))
	if err != nil || id == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid version UUID is required.")
		return uuid.Nil, false
	}
	return id, true
}
func (d whiteboardHistoryControllerV2) get(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity.identity(w, r, "view")
	if !ok {
		return
	}
	id, ok := historyVersion(w, r)
	if !ok {
		return
	}
	result, err := d.service.GetWhiteboardVersion(r.Context(), in, id)
	if err != nil {
		historyError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, result)
}
func (d whiteboardHistoryControllerV2) restore(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity.identity(w, r, "edit")
	if !ok {
		return
	}
	id, ok := historyVersion(w, r)
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
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One UUID Idempotency-Key is required.")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		whiteboardV2Error(w, r, 415, "INVALID_REQUEST", "Use application/json.")
		return
	}
	var body struct {
		ExpectedHead *string `json:"expectedHeadSequence"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || body.ExpectedHead == nil || decoder.Decode(new(any)) != io.EOF {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One expectedHeadSequence decimal string is required.")
		return
	}
	head, err := strconv.ParseInt(*body.ExpectedHead, 10, 64)
	if err != nil || head < 0 || strconv.FormatInt(head, 10) != *body.ExpectedHead {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Invalid expectedHeadSequence.")
		return
	}
	result, err := d.service.RestoreWhiteboardVersion(r.Context(), whiteboardRestoreInput{whiteboardDraftInput: in, VersionID: id, IdempotencyKey: key, ExpectedHead: head})
	if err != nil {
		historyError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, result)
}
func (d whiteboardHistoryControllerV2) remove(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity.identity(w, r, "delete")
	if !ok {
		return
	}
	err := d.service.DeleteWhiteboardV2(r.Context(), in)
	if err != nil && !errors.Is(err, errWhiteboardV2BoardNotFound) {
		historyError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
