package editor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type assetHTTPStub struct {
	calls   int
	action  string
	input   whiteboardDraftInput
	prepare whiteboardAssetPrepareInput
	upload  uuid.UUID
	media   string
	data    []byte
	hash    string
	version *uuid.UUID
	result  whiteboardAssetUploadResult
	stream  whiteboardAssetContent
	err     error
}

func (s *assetHTTPStub) called(action string, in whiteboardDraftInput, upload uuid.UUID) (whiteboardAssetUploadResult, error) {
	s.calls++
	s.action, s.input, s.upload = action, in, upload
	return s.result, s.err
}
func (s *assetHTTPStub) PrepareAsset(_ context.Context, in whiteboardAssetPrepareInput) (whiteboardAssetUploadResult, error) {
	s.prepare = in
	return s.called("prepare", in.whiteboardDraftInput, uuid.Nil)
}
func (s *assetHTTPStub) StageAsset(_ context.Context, in whiteboardDraftInput, id uuid.UUID, media string, data []byte) (whiteboardAssetUploadResult, error) {
	s.media, s.data = media, data
	return s.called("stage", in, id)
}
func (s *assetHTTPStub) CommitAsset(_ context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	return s.called("commit", in, id)
}
func (s *assetHTTPStub) GetAssetUpload(_ context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	return s.called("status", in, id)
}
func (s *assetHTTPStub) CancelAsset(_ context.Context, in whiteboardDraftInput, id uuid.UUID) (whiteboardAssetUploadResult, error) {
	return s.called("cancel", in, id)
}
func (s *assetHTTPStub) OpenAsset(_ context.Context, in whiteboardDraftInput, hash string, version *uuid.UUID) (whiteboardAssetContent, error) {
	s.hash, s.version = hash, version
	s.called("open", in, uuid.Nil)
	return s.stream, s.err
}

func assetHTTPRouter(t *testing.T, stub *assetHTTPStub, actor uuid.UUID, allow bool, wantPermission string) *chi.Mux {
	t.Helper()
	controller := whiteboardAssetControllerV2{service: stub, identity: whiteboardPublishControllerV2{
		user: func(context.Context) (core.UserInfo, error) {
			if actor == uuid.Nil {
				return core.UserInfo{}, errors.New("no authentication")
			}
			return core.UserInfo{Id: "external-user", AId: actor.String()}, nil
		},
		permission: func(page string, a uuid.UUID, permission string) bool {
			if page != "42" || a != actor || permission != wantPermission {
				t.Fatalf("wrong authorization: %s %s %s", page, a, permission)
			}
			return allow
		},
	}}
	router := chi.NewRouter()
	controller.register(router)
	return router
}

func TestWhiteboardAssetPrepareHTTP(t *testing.T) {
	actor, space, key := uuid.New(), uuid.New(), uuid.New()
	hash := strings.Repeat("a", 64)
	valid := `{"contentHash":"` + hash + `","contentType":"image/png","byteLength":12}`
	for _, tc := range []struct {
		name, body, query, media, key string
		status                        int
	}{
		{"valid", valid, "", "application/json; charset=utf-8", key.String(), 201},
		{"unauthenticated", valid, "", "application/json", key.String(), 401},
		{"forbidden", valid, "", "application/json", key.String(), 403},
		{"query", valid, "?extra=true", "application/json", key.String(), 400},
		{"preview-query", valid, "?preview=true", "application/json", key.String(), 400},
		{"missing-key", valid, "", "application/json", "", 400},
		{"duplicate-key", valid, "", "application/json", key.String(), 400},
		{"nil-key", valid, "", "application/json", uuid.Nil.String(), 400},
		{"media", valid, "", "text/plain", key.String(), 415},
		{"unknown-field", strings.TrimSuffix(valid, "}") + `,"width":1}`, "", "application/json", key.String(), 400},
		{"duplicate-field", strings.TrimSuffix(valid, "}") + `,"byteLength":12}`, "", "application/json", key.String(), 400},
		{"wrong-case", strings.Replace(valid, "contentHash", "ContentHash", 1), "", "application/json", key.String(), 400},
		{"invalid-hash", strings.Replace(valid, hash, strings.Repeat("A", 64), 1), "", "application/json", key.String(), 400},
		{"missing-field", `{"contentHash":"` + hash + `","contentType":"image/png"}`, "", "application/json", key.String(), 400},
		{"null", "null", "", "application/json", key.String(), 400},
		{"null-length", strings.Replace(valid, ":12", ":null", 1), "", "application/json", key.String(), 400},
		{"fractional-length", strings.Replace(valid, ":12", ":1.2", 1), "", "application/json", key.String(), 400},
		{"unsupported", strings.Replace(valid, "image/png", "image/svg+xml", 1), "", "application/json", key.String(), 415},
		{"negative-size", strings.Replace(valid, ":12", ":-1", 1), "", "application/json", key.String(), 400},
		{"too-many-bytes", strings.Replace(valid, ":12", fmt.Sprintf(":%d", whiteboardAssetMaxBytes+1), 1), "", "application/json", key.String(), 413},
		{"body-limit", strings.Repeat(" ", whiteboardAssetPrepareMaxBytes+1), "", "application/json", key.String(), 413},
		{"trailing-json", valid + `{}`, "", "application/json", key.String(), 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &assetHTTPStub{result: whiteboardAssetUploadResult{UploadID: uuid.New(), State: "prepared"}}
			identityActor := actor
			if tc.name == "unauthenticated" {
				identityActor = uuid.Nil
			}
			req := httptest.NewRequest("POST", "/space/"+space.String()+"/whiteboard/42/assets/uploads"+tc.query, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", tc.media)
			if tc.key != "" {
				req.Header.Set("Idempotency-Key", tc.key)
			}
			if tc.name == "duplicate-key" {
				req.Header.Add("Idempotency-Key", tc.key)
			}
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, identityActor, tc.name != "forbidden", "edit").ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing response protections")
			}
			if tc.status == 201 {
				if stub.calls != 1 || stub.prepare.IdempotencyKey != key || stub.input.ActorID != actor || stub.input.SpaceID != space || stub.input.PageID != 42 || stub.prepare.ContentHash != hash {
					t.Fatalf("wrong service input %+v", stub)
				}
				var body struct {
					Data whiteboardAssetUploadResult `json:"data"`
				}
				if json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Data.UploadID != stub.result.UploadID {
					t.Fatal(w.Body.String())
				}
			} else if stub.calls != 0 {
				t.Fatal("invalid request reached service")
			}
		})
	}
}

func TestWhiteboardAssetSessionHTTP(t *testing.T) {
	actor, space, upload := uuid.New(), uuid.New(), uuid.New()
	for _, tc := range []struct {
		name, method, suffix, body, media string
		status                            int
	}{
		{"stage", "PUT", "/content", "png bytes", "image/png", 200},
		{"jpeg", "PUT", "/content", "jpeg bytes", "image/jpeg", 200},
		{"webp", "PUT", "/content", "webp bytes", "image/webp", 200},
		{"stage-media", "PUT", "/content", "data", "application/octet-stream", 415},
		{"stage-parameters", "PUT", "/content", "data", "image/png; charset=utf-8", 415},
		{"stage-encoding", "PUT", "/content", "data", "image/png", 415},
		{"stage-empty", "PUT", "/content", "", "image/png", 400},
		{"stage-limit", "PUT", "/content", strings.Repeat("x", whiteboardAssetMaxBytes+1), "image/png", 413},
		{"commit", "POST", "/commit", "", "", 200},
		{"commit-body", "POST", "/commit", "{}", "application/json", 400},
		{"status", "GET", "", "", "", 200},
		{"cancel", "DELETE", "", "", "", 200},
		{"cancel-pending", "DELETE", "", "", "", 202},
		{"cancel-committed", "DELETE", "", "", "", 200},
		{"invalid-upload", "GET", "", "", "", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &assetHTTPStub{result: whiteboardAssetUploadResult{UploadID: upload, State: "staged", CleanupPending: tc.name == "cancel-pending", Retained: tc.name == "cancel-committed"}}
			path := "/space/" + space.String() + "/whiteboard/42/assets/uploads/" + upload.String() + tc.suffix
			if tc.name == "invalid-upload" {
				path = strings.Replace(path, upload.String(), "invalid", 1)
			}
			req := httptest.NewRequest(tc.method, path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", tc.media)
			if tc.name == "stage-encoding" {
				req.Header.Set("Content-Encoding", "gzip")
			}
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, actor, true, "edit").ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status >= 400 {
				if stub.calls != 0 {
					t.Fatal("invalid operation reached service")
				}
				return
			}
			if stub.calls != 1 || stub.upload != upload || stub.input.ActorID != actor || stub.input.SpaceID != space || stub.input.PageID != 42 {
				t.Fatalf("wrong service identity %+v", stub)
			}
			if tc.method == "PUT" && (stub.media != tc.media || string(stub.data) != tc.body) {
				t.Fatal("changed raw request")
			}
			if tc.name == "cancel-committed" && !strings.Contains(w.Body.String(), `"retained":true`) {
				t.Fatal("missing retained outcome")
			}
		})
	}
}

type assetHTTPReader struct {
	*bytes.Reader
	closed bool
}

func (r *assetHTTPReader) Close() error { r.closed = true; return nil }

func TestWhiteboardAssetDownloadHTTP(t *testing.T) {
	actor, space, version := uuid.New(), uuid.New(), uuid.New()
	hash := strings.Repeat("b", 64)
	for _, tc := range []struct {
		name, method, rangeHeader, ifRange, etag, body string
		status                                         int
		published                                      bool
	}{
		{"get", "GET", "", "", "", "0123456789", 200, false},
		{"published", "GET", "", "", "", "0123456789", 200, true},
		{"range", "GET", "bytes=2-4", "", "", "234", 206, false},
		{"suffix", "GET", "bytes=-2", "", "", "89", 206, true},
		{"head", "HEAD", "bytes=2-4", "", "", "", 200, false},
		{"published-head", "HEAD", "bytes=2-4", "", "", "", 200, true},
		{"if-range-match", "GET", "bytes=2-4", strconvQuote(hash), "", "234", 206, false},
		{"if-range-miss", "GET", "bytes=2-4", `"other"`, "", "0123456789", 200, false},
		{"etag", "GET", "", "", strconvQuote(hash), "", 304, true},
		{"multi-range", "GET", "bytes=0-1,3-4", "", "", "", 416, false},
		{"duplicate-range", "GET", "bytes=0-1", "", "", "", 416, false},
		{"unsatisfied", "GET", "bytes=99-", "", "", "", 416, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &assetHTTPReader{Reader: bytes.NewReader([]byte("0123456789"))}
			stub := &assetHTTPStub{stream: whiteboardAssetContent{Content: reader, Length: 10, Digest: hash, ContentType: "image/png"}}
			path := "/space/" + space.String() + "/whiteboard/42/"
			permission := "edit"
			if tc.published {
				path += "published/" + version.String() + "/"
				permission = "view"
			}
			path += "assets/" + hash + "/content"
			req := httptest.NewRequest(tc.method, path, nil)
			req.Header.Set("Range", tc.rangeHeader)
			req.Header.Set("If-Range", tc.ifRange)
			req.Header.Set("If-None-Match", tc.etag)
			if tc.name == "duplicate-range" {
				req.Header.Add("Range", "bytes=3-4")
			}
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, actor, true, permission).ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status < 400 && w.Body.String() != tc.body {
				t.Fatalf("body %q", w.Body.String())
			}
			if !reader.closed || stub.calls != 1 || stub.hash != hash || stub.input.PageID != 42 || stub.input.SpaceID != space {
				t.Fatal("stream/identity contract failed")
			}
			if tc.published && (stub.version == nil || *stub.version != version) || !tc.published && stub.version != nil {
				t.Fatal("version membership not passed")
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing read protections")
			}
			if tc.status == 200 || tc.status == 206 {
				if w.Header().Get("Content-Type") != "image/png" || w.Header().Get("ETag") != strconvQuote(hash) {
					t.Fatal("missing verified metadata")
				}
			}
			if tc.method == "HEAD" && w.Header().Get("Content-Length") != "10" {
				t.Fatal("HEAD did not describe full content")
			}
		})
	}
}
func strconvQuote(s string) string { return `"` + s + `"` }

func TestWhiteboardAssetHTTPErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{errWhiteboardAssetInvalid, 400, "INVALID_REQUEST"}, {errWhiteboardV2BoardNotFound, 404, "WHITEBOARD_NOT_FOUND"},
		{errWhiteboardAssetNotFound, 404, "ASSET_NOT_FOUND"}, {errWhiteboardAssetNotReady, 409, "ASSET_NOT_READY"},
		{errWhiteboardAssetExpired, 410, "ASSET_UPLOAD_EXPIRED"}, {errWhiteboardAssetConflict, 409, "ASSET_UPLOAD_CONFLICT"},
		{errWhiteboardV2KeyReuse, 409, "IDEMPOTENCY_KEY_REUSED"}, {errWhiteboardV2Archived, 409, "SPACE_ARCHIVED"},
		{quota.ErrAccountStorageLimitExceeded, 409, "ASSET_QUOTA_EXCEEDED"}, {errWhiteboardAssetTooLarge, 413, "ASSET_TOO_LARGE"},
		{errWhiteboardAssetUnsupported, 415, "UNSUPPORTED_MEDIA_TYPE"}, {errWhiteboardAssetUnavailable, 503, "ASSET_CONTENT_UNAVAILABLE"},
		{errWhiteboardAssetBusy, 503, "ASSET_UPLOAD_BUSY"}, {errWhiteboardV2LockTimeout, 503, "ASSET_UPLOAD_BUSY"},
		{&pgconn.PgError{Code: "55P03"}, 503, "ASSET_UPLOAD_BUSY"}, {&pgconn.PgError{Code: "40P01"}, 503, "ASSET_UPLOAD_BUSY"},
		{errors.New("database private detail"), 500, "ASSET_OPERATION_FAILED"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			stub := &assetHTTPStub{err: fmt.Errorf("private wrapper: %w", tc.err)}
			req := httptest.NewRequest("GET", "/space/"+uuid.New().String()+"/whiteboard/42/assets/uploads/"+uuid.New().String(), nil)
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, uuid.New(), true, "edit").ServeHTTP(w, req)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), `"code":"`+tc.code+`"`) {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private") {
				t.Fatal("internal detail leaked")
			}
			if tc.status == 503 && w.Header().Get("Retry-After") != "1" {
				t.Fatal("missing retry guidance")
			}
		})
	}
}

func TestWhiteboardAssetDownloadValidationHTTP(t *testing.T) {
	actor, space, version := uuid.New(), uuid.New(), uuid.New()
	hash := strings.Repeat("c", 64)
	for _, tc := range []struct {
		name, suffix, permission string
		status                   int
	}{
		{"auth", "assets/" + hash + "/content", "edit", 401},
		{"forbidden", "assets/" + hash + "/content", "edit", 403},
		{"published-forbidden", "published/" + version.String() + "/assets/" + hash + "/content", "view", 403},
		{"bad-hash", "assets/" + strings.Repeat("C", 64) + "/content", "edit", 400},
		{"bad-version", "published/invalid/assets/" + hash + "/content", "view", 400},
		{"zero-version", "published/" + uuid.Nil.String() + "/assets/" + hash + "/content", "view", 400},
		{"query", "assets/" + hash + "/content?preview=true", "edit", 400},
		{"published-query", "published/" + version.String() + "/assets/" + hash + "/content?preview=true", "view", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &assetHTTPStub{}
			identity := actor
			if tc.name == "auth" {
				identity = uuid.Nil
			}
			request := httptest.NewRequest("GET", "/space/"+space.String()+"/whiteboard/42/"+tc.suffix, nil)
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, identity, !strings.Contains(tc.name, "forbidden"), tc.permission).ServeHTTP(w, request)
			if w.Code != tc.status || stub.calls != 0 {
				t.Fatalf("status=%d calls=%d body=%s", w.Code, stub.calls, w.Body.String())
			}
		})
	}
}

func TestWhiteboardAssetDownloadRejectsInvalidStorageMetadata(t *testing.T) {
	hash := strings.Repeat("d", 64)
	for _, tc := range []string{"nil-reader", "wrong-digest", "unverified-mime", "empty-object"} {
		t.Run(tc, func(t *testing.T) {
			reader := &assetHTTPReader{Reader: bytes.NewReader([]byte("image"))}
			stream := whiteboardAssetContent{Content: reader, Length: 5, Digest: hash, ContentType: "image/png"}
			switch tc {
			case "nil-reader":
				stream.Content = nil
			case "wrong-digest":
				stream.Digest = strings.Repeat("e", 64)
			case "unverified-mime":
				stream.ContentType = "text/html"
			case "empty-object":
				stream.Length = 0
			}
			stub := &assetHTTPStub{stream: stream}
			req := httptest.NewRequest("GET", "/space/"+uuid.New().String()+"/whiteboard/42/assets/"+hash+"/content", nil)
			w := httptest.NewRecorder()
			assetHTTPRouter(t, stub, uuid.New(), true, "edit").ServeHTTP(w, req)
			if w.Code != 503 || !strings.Contains(w.Body.String(), "ASSET_CONTENT_UNAVAILABLE") || (tc != "nil-reader" && !reader.closed) {
				t.Fatalf("status=%d closed=%v body=%s", w.Code, reader.closed, w.Body.String())
			}
		})
	}
}

func TestWhiteboardAssetSnapshotErrorsHTTP(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{errWhiteboardSnapshotAssetInvalid, "ASSET_INVALID_REFERENCE"},
		{errWhiteboardSnapshotAssetNotReady, "ASSET_NOT_READY"},
	} {
		for _, handler := range []func(http.ResponseWriter, *http.Request, error){publishHTTPError, historyError} {
			w := httptest.NewRecorder()
			handler(w, httptest.NewRequest("POST", "/", nil), fmt.Errorf("private detail: %w", tc.err))
			if w.Code != 409 || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "private") {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		}
	}
}

var _ io.ReadSeekCloser = (*assetHTTPReader)(nil)
var _ http.Handler = (*chi.Mux)(nil)
