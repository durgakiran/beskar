package editor

import (
	"context"
	"errors"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"net/http/httptest"
	"strings"
	"testing"
)

type historyStub struct {
	calls   int
	err     error
	restore whiteboardRestoreInput
	before  int64
	limit   int
}

func (s *historyStub) GetWhiteboardVersion(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardPublishedManifest, error) {
	s.calls++
	return whiteboardPublishedManifest{}, s.err
}
func (s *historyStub) ListWhiteboardVersions(_ context.Context, _ whiteboardDraftInput, b int64, l int) (whiteboardVersionList, error) {
	s.calls++
	s.before = b
	s.limit = l
	return whiteboardVersionList{}, s.err
}
func (s *historyStub) RestoreWhiteboardVersion(_ context.Context, in whiteboardRestoreInput) (whiteboardRestoreResult, error) {
	s.calls++
	s.restore = in
	return whiteboardRestoreResult{}, s.err
}
func (s *historyStub) DeleteWhiteboardV2(context.Context, whiteboardDraftInput) error {
	s.calls++
	return s.err
}
func TestHistoryV2HTTP(t *testing.T) {
	for _, tc := range []struct {
		name, method, suffix, body string
		status                     int
		cause                      error
	}{
		{"list", "GET", "/versions?limit=2&before=9007199254740993", "", 200, nil},
		{"metadata", "GET", "/versions/VERSION", "", 200, nil},
		{"restore", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":"9007199254740993"}`, 200, nil},
		{"delete", "DELETE", "", "", 204, nil},
		{"missingDelete", "DELETE", "", "", 204, errWhiteboardV2BoardNotFound},
		{"children", "DELETE", "", "", 409, errWhiteboardHasChildren},
		{"conflict", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":"0"}`, 409, errWhiteboardHeadChanged},
		{"missing", "GET", "/versions/VERSION", "", 404, errWhiteboardV2BoardNotFound},
		{"unknownQuery", "GET", "/versions?x=2", "", 400, nil},
		{"duplicateQuery", "GET", "/versions?limit=2&limit=3", "", 400, nil},
		{"largeLimit", "GET", "/versions?limit=101", "", 400, nil},
		{"invalidVersion", "GET", "/versions/invalid", "", 400, nil},
		{"number", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":1}`, 400, nil},
		{"negative", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":"-1"}`, 400, nil},
		{"unknownBody", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":"0","other":1}`, 400, nil},
		{"key", "POST", "/versions/VERSION/restore", `{"expectedHeadSequence":"0"}`, 400, nil},
		{"auth", "GET", "/versions", "", 401, nil},
		{"forbidden", "DELETE", "", "", 403, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor, space, version := uuid.New(), uuid.New(), uuid.New()
			stub := &historyStub{err: tc.cause}
			identity := whiteboardPublishControllerV2{user: func(context.Context) (core.UserInfo, error) {
				if tc.name == "auth" {
					return core.UserInfo{}, errors.New("auth")
				}
				return core.UserInfo{Id: "user", AId: actor.String()}, nil
			}, permission: func(page string, a uuid.UUID, p string) bool {
				want := "view"
				if tc.method == "POST" {
					want = "edit"
				}
				if tc.method == "DELETE" {
					want = "delete"
				}
				if p != want || a != actor || page != "42" {
					t.Fatalf("wrong permission %s", p)
				}
				return tc.name != "forbidden"
			}}
			router := chi.NewRouter()
			d := whiteboardHistoryControllerV2{identity: identity, service: stub}
			d.register(router)
			req := httptest.NewRequest(tc.method, "/space/"+space.String()+"/whiteboard/42"+strings.ReplaceAll(tc.suffix, "VERSION", version.String()), strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			if tc.name != "key" {
				req.Header.Set("Idempotency-Key", uuid.NewString())
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != tc.status {
				t.Fatalf("%d: %s", response.Code, response.Body.String())
			}
			if tc.status >= 400 && tc.cause == nil && stub.calls != 0 {
				t.Fatal("invalid request reached service")
			}
			if tc.name == "restore" && stub.restore.ExpectedHead != 9007199254740993 {
				t.Fatal("head lost precision")
			}
			if tc.name == "list" && (stub.limit != 2 || stub.before != 9007199254740993) {
				t.Fatal("pagination mismatch")
			}
		})
	}
}
func TestCheckpointRestoreGeneration(t *testing.T) {
	for _, value := range []string{`1`, `"-1"`, `"01"`, `"9223372036854775808"`} {
		if _, _, err := validateWhiteboardCheckpointV2([]byte(`{"updateEncoding":"yjs-update-v1","update":"AAA=","restoreGeneration":` + value + `}`)); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	a := whiteboardCheckpointV2Input{UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: []byte{0, 0}}
	b := a
	b.RestoreGeneration = 1
	if whiteboardCheckpointV2Hash(a) == whiteboardCheckpointV2Hash(b) {
		t.Fatal("generation missing from request identity")
	}
}
