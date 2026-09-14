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
	"github.com/google/uuid"
)

type whiteboardCreatorV2Func func(context.Context, whiteboardCreateV2Input) (whiteboardCreateV2Result, error)

func (create whiteboardCreatorV2Func) CreateWhiteboard(ctx context.Context, input whiteboardCreateV2Input) (whiteboardCreateV2Result, error) {
	return create(ctx, input)
}

func TestWhiteboardCreateV2HTTP(t *testing.T) {
	actor, space, key := uuid.New(), uuid.New(), uuid.New()
	for _, tc := range []struct {
		name   string
		status int
		code   string
	}{
		{"success", 201, ""}, {"unauthenticated", 401, "UNAUTHENTICATED"},
		{"bad-space", 400, "INVALID_REQUEST"}, {"missing-key", 400, "INVALID_REQUEST"},
		{"duplicate-key", 400, "INVALID_REQUEST"}, {"bad-key", 400, "INVALID_REQUEST"},
		{"wrong-content-type", 415, "UNSUPPORTED_MEDIA_TYPE"}, {"oversized", 413, "REQUEST_TOO_LARGE"},
		{"forbidden", 403, "CREATE_WHITEBOARD_FORBIDDEN"}, {"parent-forbidden", 403, "CREATE_WHITEBOARD_FORBIDDEN"},
		{"archived", 409, "SPACE_ARCHIVED"}, {"missing-parent", 404, "SPACE_OR_PARENT_NOT_FOUND"},
		{"key-reuse", 409, "IDEMPOTENCY_KEY_REUSED"}, {"database-error", 500, "WHITEBOARD_CREATE_FAILED"},
		{"lock-timeout", 503, "WHITEBOARD_CREATE_BUSY"},
		{"provision-error", 503, "WHITEBOARD_PERMISSIONS_PENDING"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created := false
			deps := whiteboardControllerV2{
				user: func(context.Context) (core.UserInfo, error) {
					if tc.name == "unauthenticated" {
						return core.UserInfo{}, errors.New("no session")
					}
					return core.UserInfo{Id: "external-user", AId: actor.String()}, nil
				},
				canCreate: func(s, a uuid.UUID, permission string) bool {
					if s != space || a != actor || permission != "edit_page" {
						t.Fatal("wrong space authorization")
					}
					return tc.name != "forbidden"
				},
				canEdit: func(id string, a uuid.UUID, permission string) bool {
					if id != "123" || a != actor || permission != "edit" {
						t.Fatal("wrong parent authorization")
					}
					return tc.name != "parent-forbidden"
				},
				service: whiteboardCreatorV2Func(func(_ context.Context, input whiteboardCreateV2Input) (whiteboardCreateV2Result, error) {
					created = true
					if input.Title != "Board" || input.ActorID != actor || input.SpaceID != space || input.IdempotencyKey != key {
						t.Fatalf("unexpected input: %+v", input)
					}
					errs := map[string]error{"archived": errWhiteboardV2Archived, "missing-parent": errWhiteboardV2NotFound,
						"lock-timeout": errWhiteboardV2LockTimeout, "key-reuse": errWhiteboardV2KeyReuse, "database-error": errors.New("database secret"), "provision-error": errWhiteboardV2PermissionsPending}
					return whiteboardCreateV2Result{PageID: 42, SpaceID: space}, errs[tc.name]
				}),
			}
			path := "/space/" + space.String() + "/whiteboard/create"
			if tc.name == "bad-space" {
				path = "/space/not-a-uuid/whiteboard/create"
			}
			body := `{"title":" Board "}`
			if tc.name == "parent-forbidden" {
				body = `{"title":"Board","parentId":123}`
			}
			if tc.name == "oversized" {
				body = strings.Repeat(" ", whiteboardCreateV2MaxBody+1)
			}
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			req.Header.Set("Idempotency-Key", key.String())
			switch tc.name {
			case "missing-key":
				req.Header.Del("Idempotency-Key")
			case "bad-key":
				req.Header.Set("Idempotency-Key", "invalid")
			case "duplicate-key":
				req.Header.Add("Idempotency-Key", key.String())
			case "wrong-content-type":
				req.Header.Set("Content-Type", "text/plain")
			}
			res := httptest.NewRecorder()
			whiteboardRouterV2(deps).ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
			if tc.code != "" && !strings.Contains(res.Body.String(), `"code":"`+tc.code+`"`) {
				t.Fatal(res.Body.String())
			}
			if strings.Contains(res.Body.String(), "database secret") {
				t.Fatal("leaked database error")
			}
			if tc.status == 201 {
				var body struct {
					Data map[string]any `json:"data"`
				}
				if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if len(body.Data) != 2 || body.Data["pageId"] != float64(42) || body.Data["spaceId"] != space.String() {
					t.Fatal(body)
				}
			} else if tc.status == 503 {
				if res.Header().Get("Retry-After") != "1" {
					t.Fatal("missing retry guidance")
				}
			}
			if (tc.status == 400 || tc.status == 401 || tc.status == 403 || tc.status == 413 || tc.status == 415) && created {
				t.Fatal("creation ran before request validation/authorization")
			}
		})
	}
}
