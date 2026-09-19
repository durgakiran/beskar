package editor

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type checkpointFunc func(context.Context, whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error)

func (f checkpointFunc) CheckpointWhiteboard(ctx context.Context, in whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error) {
	return f(ctx, in)
}
func TestCheckpointV2HTTP(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		code   string
		cause  error
	}{
		{"success", 200, "", nil}, {"auth", 401, "UNAUTHENTICATED", nil}, {"forbidden", 403, "CHECKPOINT_FORBIDDEN", nil},
		{"page", 400, "INVALID_REQUEST", nil}, {"space", 400, "INVALID_REQUEST", nil}, {"key", 400, "INVALID_REQUEST", nil}, {"duplicate-key", 400, "INVALID_REQUEST", nil},
		{"media", 415, "UNSUPPORTED_MEDIA_TYPE", nil}, {"body", 400, "INVALID_REQUEST", nil}, {"large-request", 413, "REQUEST_TOO_LARGE", nil}, {"large-update", 413, "REQUEST_TOO_LARGE", nil},
		{"notfound", 404, "WHITEBOARD_NOT_FOUND", errWhiteboardV2BoardNotFound}, {"archived", 409, "SPACE_ARCHIVED", errWhiteboardV2Archived},
		{"reuse", 409, "IDEMPOTENCY_KEY_REUSED", errWhiteboardV2KeyReuse}, {"timeout", 503, "WHITEBOARD_CHECKPOINT_BUSY", errWhiteboardV2LockTimeout},
		{"db", 500, "WHITEBOARD_CHECKPOINT_FAILED", errors.New("secret sql")}, {"draft", 500, "WHITEBOARD_CHECKPOINT_FAILED", errWhiteboardV2DraftMissing},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor, space, key, updateID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
			called := false
			deps := whiteboardCheckpointControllerV2{
				user: func(context.Context) (core.UserInfo, error) {
					if tc.name == "auth" {
						return core.UserInfo{}, errors.New("auth")
					}
					return core.UserInfo{Id: "user", AId: actor.String()}, nil
				},
				canEdit: func(id string, a uuid.UUID, p string) bool {
					if id != "42" || a != actor || p != "edit" {
						t.Fatal("wrong authorization")
					}
					return tc.name != "forbidden"
				},
				service: checkpointFunc(func(_ context.Context, in whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error) {
					called = true
					if in.PageID != 42 || in.SpaceID != space || in.ActorID != actor || in.IdempotencyKey != key || in.UpdateEncoding != whiteboardUpdateEncodingV1 || string(in.UpdateBytes) != string([]byte{0, 0}) {
						t.Fatal("wrong input")
					}
					return whiteboardCheckpointV2Result{PageID: 42, UpdateID: updateID, Sequence: 9007199254740992}, tc.cause
				}),
			}
			path := "/space/" + space.String() + "/whiteboard/42/checkpoint"
			if tc.name == "page" {
				path = strings.Replace(path, "/42/", "/no/", 1)
			}
			if tc.name == "space" {
				path = strings.Replace(path, space.String(), "no", 1)
			}
			body := checkpointPayload([]byte{0, 0})
			if tc.name == "body" {
				body = []byte("{}")
			}
			if tc.name == "large-request" {
				body = []byte(strings.Repeat(" ", whiteboardCheckpointV2MaxBody+1))
			}
			if tc.name == "large-update" {
				body = checkpointPayload(make([]byte, whiteboardCheckpointV2MaxUpdate+1))
			}
			req := httptest.NewRequest("POST", path, strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", key.String())
			if tc.name == "media" {
				req.Header.Set("Content-Type", "text/plain")
			}
			if tc.name == "key" {
				req.Header.Del("Idempotency-Key")
			}
			if tc.name == "duplicate-key" {
				req.Header.Add("Idempotency-Key", uuid.NewString())
			}
			router := chi.NewRouter()
			router.Post("/space/{spaceId}/whiteboard/{pageId}/checkpoint", deps.handleCheckpoint)
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("%d %s", res.Code, res.Body.String())
			}
			if tc.code != "" && !strings.Contains(res.Body.String(), `"code":"`+tc.code+`"`) {
				t.Fatal(res.Body.String())
			}
			if strings.Contains(res.Body.String(), "secret sql") {
				t.Fatal("leaked SQL")
			}
			if tc.status == 503 && res.Header().Get("Retry-After") != "1" {
				t.Fatal("missing retry header")
			}
			if tc.cause == nil && tc.status != 200 && called {
				t.Fatal("called service on invalid request")
			}
			if tc.status == 200 {
				var result struct {
					Data struct {
						Sequence string
						UpdateID uuid.UUID
					}
				}
				if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Data.Sequence != "9007199254740992" || result.Data.UpdateID != updateID {
					t.Fatal("lost exact sequence or ID")
				}
			}
		})
	}
}

func TestCheckpointV2RouteRegistered(t *testing.T) {
	found := false
	err := chi.Walk(RouterV2(), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method == "POST" && route == "/space/{spaceId}/whiteboard/{pageId}/checkpoint" {
			found = true
		}
		return nil
	})
	if err != nil || !found {
		t.Fatalf("checkpoint route missing: %v", err)
	}
}
