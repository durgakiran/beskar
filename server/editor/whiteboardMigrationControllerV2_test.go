package editor

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type migrationHTTPStub struct {
	calls int
	err   error
	input whiteboardMigrationInput
}

func (s *migrationHTTPStub) GetMigrationSource(_ context.Context, in whiteboardDraftInput) (whiteboardMigrationSource, error) {
	s.calls++
	s.input.whiteboardDraftInput = in
	return whiteboardMigrationSource{ContentAPIVersion: 1}, s.err
}
func (s *migrationHTTPStub) MigrateWhiteboard(_ context.Context, in whiteboardMigrationInput) (whiteboardMigrationResult, error) {
	s.calls++
	s.input = in
	return whiteboardMigrationResult{PageID: in.PageID, ContentAPIVersion: 2}, s.err
}
func TestMigrationHTTP(t *testing.T) {
	for _, tc := range []struct {
		name, method, body string
		status             int
		cause              error
	}{
		{"source", "GET", "", 200, nil}, {"migrate", "POST", `{"sourceDocId":"10"}`, 200, nil},
		{"auth", "GET", "", 401, nil}, {"forbidden", "GET", "", 403, nil},
		{"key", "POST", `{}`, 400, nil}, {"media", "POST", `{}`, 415, nil},
		{"unknown", "POST", `{"unexpected":true}`, 400, nil}, {"trailing", "POST", `{} {}`, 400, nil},
		{"assets source", "GET", "", 409, errWhiteboardMigrationAssets}, {"assets submit", "POST", `{}`, 409, errWhiteboardMigrationAssets},
		{"format", "POST", `{}`, 422, errWhiteboardMigrationFormat}, {"changed", "POST", `{}`, 409, errWhiteboardMigrationSource},
		{"asset mismatch", "POST", `{}`, 422, errWhiteboardMigrationAssetMismatch}, {"asset unavailable", "POST", `{}`, 503, errWhiteboardAssetUnavailable},
		{"asset missing", "POST", `{}`, 404, errWhiteboardAssetNotFound}, {"asset quota", "POST", `{}`, 409, quota.ErrAccountStorageLimitExceeded},
		{"asset busy", "POST", `{}`, 503, errWhiteboardAssetBusy},
		{"missing", "GET", "", 404, errWhiteboardV2BoardNotFound}, {"archive", "POST", `{}`, 409, errWhiteboardV2Archived},
		{"private error", "GET", "", 500, errors.New("private database details")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor, space := uuid.New(), uuid.New()
			stub := &migrationHTTPStub{err: tc.cause}
			controller := whiteboardMigrationControllerV2{service: stub, identity: whiteboardPublishControllerV2{
				user: func(context.Context) (core.UserInfo, error) {
					if tc.name == "auth" {
						return core.UserInfo{}, errors.New("auth")
					}
					return core.UserInfo{Id: "user", AId: actor.String()}, nil
				},
				permission: func(page string, id uuid.UUID, permission string) bool {
					if page != "42" || id != actor || permission != "edit" {
						t.Fatal("must authorize edit, including source reads")
					}
					return tc.name != "forbidden"
				},
			}}
			route := chi.NewRouter()
			controller.register(route)
			suffix := "migration-source"
			if tc.method == "POST" {
				suffix = "migrate"
			}
			request := httptest.NewRequest(tc.method, "/space/"+space.String()+"/whiteboard/42/"+suffix, strings.NewReader(tc.body))
			if tc.name != "key" {
				request.Header.Set("Idempotency-Key", uuid.NewString())
			}
			if tc.name != "media" {
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()
			route.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("migration data must not be cached")
			}
			if tc.status == 401 || tc.status == 403 || tc.status == 400 || tc.status == 415 {
				if stub.calls != 0 {
					t.Fatal("invalid request reached service")
				}
			}
			if strings.Contains(response.Body.String(), "private database details") {
				t.Fatal("leaked private error")
			}
		})
	}
}
