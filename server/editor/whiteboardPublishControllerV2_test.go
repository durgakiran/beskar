package editor

import (
	"bytes"
	"context"
	"errors"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"net/http/httptest"
	"strings"
	"testing"
)

type publishHTTPStub struct {
	whiteboardPublisherV2
	calls int
	input whiteboardPublishInput
	err   error
}

func (s *publishHTTPStub) PublishWhiteboard(_ context.Context, in whiteboardPublishInput) (whiteboardPublishedManifest, error) {
	s.calls++
	s.input = in
	return whiteboardPublishedManifest{}, s.err
}
func (s *publishHTTPStub) GetPublishedWhiteboard(_ context.Context, in whiteboardDraftInput) (whiteboardPublishedManifest, error) {
	s.calls++
	s.input.whiteboardDraftInput = in
	return whiteboardPublishedManifest{}, s.err
}
func TestPublishV2HTTP(t *testing.T) {
	for _, tc := range []struct {
		name, method, body string
		status             int
		cause              error
	}{
		{"publish", "POST", `{"sequence":"9007199254740992"}`, 200, nil},
		{"read", "GET", "", 200, nil},
		{"auth", "GET", "", 401, nil}, {"forbidden", "POST", `{"sequence":"0"}`, 403, nil},
		{"missing", "POST", `{}`, 400, nil}, {"number", "POST", `{"sequence":1}`, 400, nil},
		{"key", "POST", `{"sequence":"0"}`, 400, nil}, {"media", "POST", `{"sequence":"0"}`, 415, nil},
		{"notpublished", "GET", "", 404, errWhiteboardNotPublished},
		{"badsequence", "POST", `{"sequence":"0"}`, 409, errWhiteboardPublishSequence},
		{"reuse", "POST", `{"sequence":"0"}`, 409, errWhiteboardV2KeyReuse},
		{"busy", "POST", `{"sequence":"0"}`, 503, errWhiteboardV2LockTimeout},
		{"internal", "GET", "", 500, errors.New("private database detail")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor, space, key := uuid.New(), uuid.New(), uuid.New()
			stub := &publishHTTPStub{err: tc.cause}
			d := whiteboardPublishControllerV2{service: stub, user: func(context.Context) (core.UserInfo, error) {
				if tc.name == "auth" {
					return core.UserInfo{}, errors.New("auth")
				}
				return core.UserInfo{Id: "user", AId: actor.String()}, nil
			}, permission: func(page string, a uuid.UUID, p string) bool {
				want := "edit"
				if tc.method == "GET" {
					want = "view"
				}
				if p != want || page != "42" || a != actor {
					t.Fatal("wrong permission")
				}
				return tc.name != "forbidden"
			}}
			router := chi.NewRouter()
			d.register(router)
			suffix := "publish"
			if tc.method == "GET" {
				suffix = "published"
			}
			if tc.method == "POST" && (tc.status == 200 || tc.cause != nil) {
				tc.body = publishBodyWithPreview(t, tc.body)
			}
			req := httptest.NewRequest(tc.method, "/space/"+space.String()+"/whiteboard/42/"+suffix, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", key.String())
			if tc.name == "key" {
				req.Header.Del("Idempotency-Key")
			}
			if tc.name == "media" {
				req.Header.Del("Content-Type")
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private database detail") {
				t.Fatal("leaked internal error")
			}
			if tc.status == 200 || tc.cause != nil {
				if stub.calls != 1 || stub.input.SpaceID != space || stub.input.ActorID != actor {
					t.Fatal("wrong service call")
				}
			} else if stub.calls != 0 {
				t.Fatal("invalid request reached service")
			}
			if tc.name == "publish" && (stub.input.Sequence != 9007199254740992 || stub.input.IdempotencyKey != key) {
				t.Fatal("lost sequence precision or key")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing cache protection")
			}
		})
	}
}
func TestPublishSequenceValidation(t *testing.T) {
	for _, body := range []string{`null`, `{"sequence":null}`, `{"sequence":"-1"}`, `{"sequence":"01"}`, `{"sequence":"+1"}`, `{"sequence":"9223372036854775808"}`, `{"sequence":"1","unknown":1}`, `{"sequence":"1"} {}`} {
		if _, err := validateWhiteboardPublish([]byte(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
}

type publishedDownloadStub struct {
	whiteboardPublisherV2
	stream  *draftTestStream
	version uuid.UUID
}

func (s *publishedDownloadStub) OpenPublishedSnapshot(_ context.Context, _ whiteboardDraftInput, version uuid.UUID) (whiteboardSnapshotStream, error) {
	s.version = version
	return whiteboardSnapshotStream{Content: s.stream, Length: 6, Digest: "sha256:test"}, nil
}
func TestPublishedDownloadHTTP(t *testing.T) {
	for _, tc := range []struct {
		method, byteRange, want string
		status                  int
	}{
		{"GET", "", "abcdef", 200}, {"GET", "bytes=1-3", "bcd", 206}, {"HEAD", "bytes=1-3", "", 200}, {"GET", "bytes=99-", "", 416}, {"GET", "bytes=0-1,3-4", "", 416},
	} {
		t.Run(tc.method+tc.byteRange, func(t *testing.T) {
			version, actor, space := uuid.New(), uuid.New(), uuid.New()
			stub := &publishedDownloadStub{stream: &draftTestStream{Reader: bytes.NewReader([]byte("abcdef"))}}
			d := whiteboardPublishControllerV2{service: stub, user: func(context.Context) (core.UserInfo, error) {
				return core.UserInfo{Id: "user", AId: actor.String()}, nil
			}, permission: func(_ string, _ uuid.UUID, p string) bool { return p == "view" }}
			r := chi.NewRouter()
			d.register(r)
			req := httptest.NewRequest(tc.method, "/space/"+space.String()+"/whiteboard/42/published/"+version.String()+"/content", nil)
			req.Header.Set("Range", tc.byteRange)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status < 400 && w.Body.String() != tc.want {
				t.Fatalf("content %q", w.Body.String())
			}
			if stub.version != version || !stub.stream.closed || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("version, resource cleanup, or cache protection failed")
			}
		})
	}
}
