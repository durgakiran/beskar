package editor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type draftTestStream struct {
	*bytes.Reader
	closed bool
}

func (s *draftTestStream) Close() error { s.closed = true; return nil }

type draftTestService struct {
	calls  int
	err    error
	stream *draftTestStream
	input  whiteboardDraftInput
}

func (s *draftTestService) GetDraft(_ context.Context, in whiteboardDraftInput) (whiteboardDraftManifest, error) {
	s.calls++
	s.input = in
	return whiteboardDraftManifest{PageID: in.PageID, HeadSequence: 9007199254740993}, s.err
}
func (s *draftTestService) GetDraftUpdates(_ context.Context, in whiteboardDraftInput, _ string) (whiteboardDraftPage, error) {
	s.calls++
	s.input = in
	return whiteboardDraftPage{Updates: []whiteboardDraftUpdate{}, Complete: true}, s.err
}
func (s *draftTestService) OpenDraftSnapshot(_ context.Context, in whiteboardDraftInput, _, _ uuid.UUID) (whiteboardSnapshotStream, error) {
	s.calls++
	s.input = in
	return whiteboardSnapshotStream{Content: s.stream, Length: int64(s.stream.Len()), Digest: "sha256:test"}, s.err
}
func draftTestRouter(s whiteboardDraftReader, authenticated, allowed bool) http.Handler {
	r := chi.NewRouter()
	deps := whiteboardDraftControllerV2{service: s, user: func(context.Context) (core.UserInfo, error) {
		if !authenticated {
			return core.UserInfo{}, errors.New("no identity")
		}
		return core.UserInfo{Id: "user", AId: "0195ad23-831a-7000-8000-000000000001"}, nil
	}, canEdit: func(_ string, _ uuid.UUID, permission string) bool {
		if permission != "edit" {
			panic("wrong permission")
		}
		return allowed
	}}
	deps.register(r)
	return r
}

const draftTestPath = "/space/c7022348-1bb3-4e52-8403-17786e15e035/whiteboard/42"
const draftTestContentPath = draftTestPath + "/snapshots/0195ad23-831a-7000-8000-000000000002/content?replay=0195ad23-831a-7000-8000-000000000003"

func TestDraftV2AuthorizationAndValidation(t *testing.T) {
	for _, suffix := range []string{"/draft", "/draft/updates?cursor=x", "/snapshots/0195ad23-831a-7000-8000-000000000002/content?replay=0195ad23-831a-7000-8000-000000000003"} {
		for _, tc := range []struct {
			auth, allow bool
			code        int
		}{{false, true, 401}, {true, false, 403}} {
			service := &draftTestService{}
			w := httptest.NewRecorder()
			draftTestRouter(service, tc.auth, tc.allow).ServeHTTP(w, httptest.NewRequest("GET", draftTestPath+suffix, nil))
			if w.Code != tc.code || service.calls != 0 {
				t.Fatalf("%s: %d calls=%d", suffix, w.Code, service.calls)
			}
		}
	}
	for _, path := range []string{strings.Replace(draftTestPath, "/42", "/9007199254740992", 1) + "/draft", draftTestPath + "/draft?foo=1", draftTestPath + "/draft/updates", draftTestPath + "/draft/updates?cursor=x&cursor=y", draftTestPath + "/draft/updates?cursor=x&extra=1", draftTestPath + "/draft/updates?cursor=%ZZ", draftTestPath + "/snapshots/no/content?replay=no"} {
		service := &draftTestService{}
		w := httptest.NewRecorder()
		draftTestRouter(service, true, true).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 400 || service.calls != 0 {
			t.Fatalf("%s: %d calls=%d", path, w.Code, service.calls)
		}
	}
}
func TestDraftV2ManifestAndErrors(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code int
		body string
	}{{nil, 200, `"headSequence":"9007199254740993"`}, {errWhiteboardDraftExpired, 410, "DRAFT_REPLAY_EXPIRED"}, {errWhiteboardDraftCursor, 400, "INVALID_REQUEST"}, {errWhiteboardV2BoardNotFound, 404, "WHITEBOARD_NOT_FOUND"}, {errWhiteboardV2LockTimeout, 503, "WHITEBOARD_DRAFT_BUSY"}, {errWhiteboardDraftIntegrity, 500, "WHITEBOARD_DRAFT_READ_FAILED"}} {
		service := &draftTestService{err: tc.err}
		w := httptest.NewRecorder()
		draftTestRouter(service, true, true).ServeHTTP(w, httptest.NewRequest("GET", draftTestPath+"/draft", nil))
		if w.Code != tc.code || !strings.Contains(w.Body.String(), tc.body) || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%v: %d %s", tc.err, w.Code, w.Body.String())
		}
	}
}
func TestDraftV2SnapshotRanges(t *testing.T) {
	for _, tc := range []struct {
		method, rangeHeader, ifRange string
		status                       int
		body, contentRange           string
	}{
		{"GET", "", "", 200, "0123456789", ""}, {"HEAD", "", "", 200, "", ""},
		{"HEAD", "bytes=2-5", "", 200, "", ""},
		{"GET", "bytes=2-5", "", 206, "2345", "bytes 2-5/10"}, {"GET", "bytes=7-", "", 206, "789", "bytes 7-9/10"}, {"GET", "bytes=-3", "", 206, "789", "bytes 7-9/10"},
		{"GET", "bytes=2-5", `"sha256:test"`, 206, "2345", "bytes 2-5/10"}, {"GET", "bytes=2-5", `"old"`, 200, "0123456789", ""},
		{"GET", "bytes=99-", "", 416, "", "bytes */10"}, {"GET", "bytes=0-1,5-6", "", 416, "", "bytes */10"},
	} {
		t.Run(fmt.Sprintf("%s/%s/%s", tc.method, tc.rangeHeader, tc.ifRange), func(t *testing.T) {
			stream := &draftTestStream{Reader: bytes.NewReader([]byte("0123456789"))}
			service := &draftTestService{stream: stream}
			req := httptest.NewRequest(tc.method, draftTestContentPath, nil)
			req.Header.Set("Range", tc.rangeHeader)
			if tc.ifRange != "" {
				req.Header.Set("If-Range", tc.ifRange)
			}
			w := httptest.NewRecorder()
			draftTestRouter(service, true, true).ServeHTTP(w, req)
			if w.Code != tc.status || w.Header().Get("Content-Range") != tc.contentRange || !stream.closed || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%d %v closed=%v", w.Code, w.Header(), stream.closed)
			}
			if tc.status < 400 && (w.Body.String() != tc.body || w.Header().Get("Content-Type") != "application/octet-stream" || w.Header().Get("Accept-Ranges") != "bytes") {
				t.Fatalf("body=%s headers=%v", w.Body.String(), w.Header())
			}
		})
	}
}

type draftFailingStream struct{ *bytes.Reader }

func (s draftFailingStream) Read([]byte) (int, error) { return 0, errors.New("storage failed") }
func (s draftFailingStream) Close() error             { return nil }

type draftFailingService struct{ draftTestService }

func (s *draftFailingService) OpenDraftSnapshot(context.Context, whiteboardDraftInput, uuid.UUID, uuid.UUID) (whiteboardSnapshotStream, error) {
	return whiteboardSnapshotStream{Content: draftFailingStream{bytes.NewReader([]byte("0123"))}, Length: 4, Digest: "sha256:test"}, nil
}
func TestDraftV2BrokenStreamAborts(t *testing.T) {
	defer func() {
		if recover() != http.ErrAbortHandler {
			t.Fatal("broken binary response was not aborted")
		}
	}()
	draftTestRouter(&draftFailingService{}, true, true).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", draftTestContentPath, nil))
}

func TestDraftV2Cursor(t *testing.T) {
	replay := whiteboardDraftReplay{ID: uuid.New(), Secret: uuid.New()}
	cursor := draftCursor(replay, 9007199254740993)
	id, after, _, err := parseDraftCursor(cursor)
	if err != nil || id != replay.ID || after != 9007199254740993 {
		t.Fatalf("%s %d %v", id, after, err)
	}
	for _, bad := range []string{"", cursor + "=", "broken", draftCursor(replay, -1)} {
		if _, _, _, err := parseDraftCursor(bad); err == nil {
			t.Fatal("accepted", bad)
		}
	}
}

var _ io.ReadSeekCloser = (*whiteboardSnapshotReader)(nil)

func TestDraftV2SnapshotPreconditions(t *testing.T) {
	for _, tc := range []struct {
		header, value string
		status        int
	}{
		{"If-None-Match", `"sha256:test"`, 304},
		{"If-Match", `"old"`, 412},
	} {
		stream := &draftTestStream{Reader: bytes.NewReader([]byte("0123456789"))}
		req := httptest.NewRequest("GET", draftTestContentPath, nil)
		req.Header.Set(tc.header, tc.value)
		w := httptest.NewRecorder()
		draftTestRouter(&draftTestService{stream: stream}, true, true).ServeHTTP(w, req)
		if w.Code != tc.status || w.Body.Len() != 0 || !stream.closed || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: status=%d body=%s headers=%v", tc.header, w.Code, w.Body.String(), w.Header())
		}
	}
}
