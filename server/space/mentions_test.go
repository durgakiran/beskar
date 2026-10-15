package space

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	payload "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func mentionProfile(id, label, email string) core.User {
	return core.User{UserId: id, State: "USER_STATE_ACTIVE", Human: core.Human{UserId: id, Profile: core.Profile{DisplayName: label}, Email: core.EmailAddress{Email: email}}}
}

func TestMentionSearchValidation(t *testing.T) {
	for _, raw := range []string{"limit=0", "limit=-1", "limit=bad", "limit=", "offset=-1", "offset=18446744073709551616", "limit=1&limit=2", "query=a&query=b", "query=" + strings.Repeat("a", 201)} {
		values, _ := url.ParseQuery(raw)
		if _, err := parseMentionSearch(values); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	req, err := parseMentionSearch(url.Values{"query": {" Alex Morgan "}, "limit": {"100"}, "offset": {"2"}})
	if err != nil || req.query != "Alex Morgan" || req.limit != 50 || req.offset != 2 {
		t.Fatalf("unexpected parse: %+v %v", req, err)
	}
	req, err = parseMentionSearch(url.Values{})
	if err != nil || req.limit != 10 || req.query != "" {
		t.Fatalf("unexpected defaults: %+v %v", req, err)
	}
}

func TestMentionSearchScopesFiltersThenPaginates(t *testing.T) {
	actor, spaceID := uuid.New(), uuid.New()
	roles := map[string]string{actor.String(): "owner"}
	mappings := []core.ZitaUser{}
	profiles := []core.User{}
	for i := 0; i < 22; i++ {
		id, directoryID := uuid.NewString(), fmt.Sprintf("directory-%02d", i)
		roles[id] = "editor"
		mappings = append(mappings, core.ZitaUser{UserId: id, Id: directoryID})
		profiles = append(profiles, mentionProfile(directoryID, fmt.Sprintf("Member %02d", i), fmt.Sprintf("member%02d@example.com", i)))
	}
	outsider := uuid.NewString()
	mappings = append(mappings, core.ZitaUser{UserId: outsider, Id: "outside"})
	profiles = append(profiles, mentionProfile("outside", "Member outsider", "outside@example.com"))
	profiles[1].State = "USER_STATE_INACTIVE"
	profiles[2].Human = core.Human{} // service account
	s := mentionService{
		members: func(context.Context, uuid.UUID) (map[string]string, error) { return roles, nil },
		identities: func(_ context.Context, ids []string) ([]core.ZitaUser, error) {
			if len(ids) != len(roles) {
				t.Fatalf("expected all member IDs, got %d", len(ids))
			}
			for _, id := range ids {
				if _, ok := roles[id]; !ok {
					t.Fatalf("foreign user %s", id)
				}
			}
			return mappings, nil
		},
		profiles: func(_ context.Context, ids []string) ([]core.User, error) {
			for _, id := range ids {
				if id == "outside" {
					t.Fatal("foreign directory ID queried")
				}
			}
			return profiles, nil
		},
	}
	result, err := s.search(context.Background(), spaceID, actor, mentionSearch{limit: 10})
	if err != nil || len(result.Users) != 10 || !result.HasMore || result.Users[1].Label != "Member 03" {
		t.Fatalf("unexpected first page: %+v %v", result, err)
	}
	result, err = s.search(context.Background(), spaceID, actor, mentionSearch{limit: 10, offset: 10})
	if err != nil || len(result.Users) != 10 || result.HasMore || result.Users[9].Label != "Member 21" {
		t.Fatalf("unexpected second page: %+v %v", result, err)
	}
	for _, query := range []string{"MEMBER 21", "MEMBER21@EXAMPLE.COM"} {
		result, err = s.search(context.Background(), spaceID, actor, mentionSearch{query: query, limit: 10})
		if err != nil || len(result.Users) != 1 || result.Users[0].Label != "Member 21" {
			t.Fatalf("search %q: %+v %v", query, result, err)
		}
	}
	result, err = s.search(context.Background(), spaceID, actor, mentionSearch{limit: 10, offset: ^uint64(0)})
	if err != nil || result.Users == nil || len(result.Users) != 0 || result.HasMore {
		t.Fatalf("bad out-of-range page: %+v %v", result, err)
	}
}

func TestMentionLookupScopeAndFallbacks(t *testing.T) {
	actor, target, outsider := uuid.New(), uuid.New(), uuid.New()
	profile := mentionProfile("target-directory", "", "target@example.com")
	profile.Human.UserId = "" // Actual Zitadel v2 responses may omit the nested ID.
	profile.Human.Profile.AvatarURL = "https://example.com/avatar.png"
	calls := 0
	s := mentionService{
		members: func(context.Context, uuid.UUID) (map[string]string, error) {
			return map[string]string{actor.String(): "viewer", target.String(): "commenter"}, nil
		},
		identities: func(_ context.Context, ids []string) ([]core.ZitaUser, error) {
			calls++
			if !reflect.DeepEqual(ids, []string{target.String()}) {
				t.Fatalf("detail lookup requested extra users: %v", ids)
			}
			return []core.ZitaUser{{UserId: target.String(), Id: profile.UserId}}, nil
		},
		profiles: func(context.Context, []string) ([]core.User, error) { return []core.User{profile}, nil },
	}
	for _, actorID := range []uuid.UUID{actor, outsider} {
		users, err := s.users(context.Background(), uuid.New(), actorID, target.String())
		if actorID == outsider {
			if !errors.Is(err, errMentionForbidden) {
				t.Fatalf("non-member allowed: %v", err)
			}
		} else if err != nil || len(users) != 1 || users[0].Label != profile.Human.Email.Email || users[0].SpaceRole != "commenter" || users[0].AvatarURL == nil {
			t.Fatalf("unexpected details %+v %v", users, err)
		}
	}
	if calls != 1 {
		t.Fatal("directory accessed for forbidden caller")
	}
	if _, err := s.users(context.Background(), uuid.New(), actor, outsider.String()); !errors.Is(err, errMentionNotFound) || calls != 1 {
		t.Fatal("foreign member looked up")
	}
	profile.State = "USER_STATE_DELETED"
	users, err := s.users(context.Background(), uuid.New(), actor, target.String())
	if err != nil || len(users) != 0 {
		t.Fatal("deleted account returned")
	}
	profile.State = "USER_STATE_ACTIVE"
	profile.Human.Profile.GivenName = "Alex"
	profile.Human.Profile.FamilyName = "Morgan"
	profile.Human.Profile.AvatarURL = "javascript:alert(1)"
	users, err = s.users(context.Background(), uuid.New(), actor, target.String())
	if err != nil || len(users) != 1 || users[0].Label != "Alex Morgan" || users[0].AvatarURL != nil {
		t.Fatalf("bad fallback/avatar: %+v %v", users, err)
	}
}

func TestMentionRelationshipPages(t *testing.T) {
	spaceID, owner, commenter, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	tuple := func(id uuid.UUID, role string) *payload.Tuple {
		return &payload.Tuple{Entity: &payload.Entity{Type: "space", Id: spaceID.String()}, Relation: role, Subject: &payload.Subject{Type: "user", Id: id.String()}}
	}
	calls := 0
	roles, err := readMentionRoles(context.Background(), spaceID, func(_ context.Context, req *payload.RelationshipReadRequest) (*payload.RelationshipReadResponse, error) {
		calls++
		if calls == 1 {
			wrongSpace := tuple(outsider, "viewer")
			wrongSpace.Entity.Id = uuid.NewString()
			nonUser := tuple(outsider, "viewer")
			nonUser.Subject.Type = "email"
			indirect := tuple(outsider, "viewer")
			indirect.Subject.Relation = "member"
			return &payload.RelationshipReadResponse{Tuples: []*payload.Tuple{tuple(owner, "viewer"), tuple(commenter, "commentor"), tuple(outsider, "invited"), wrongSpace, nonUser, indirect, nil}, ContinuousToken: "next"}, nil
		}
		if req.ContinuousToken != "next" {
			t.Fatal("pagination token not forwarded")
		}
		return &payload.RelationshipReadResponse{Tuples: []*payload.Tuple{tuple(owner, "owner")}}, nil
	})
	if err != nil || calls != 2 || len(roles) != 2 || roles[owner.String()] != "owner" || roles[commenter.String()] != "commenter" {
		t.Fatalf("unexpected membership: %v %v", roles, err)
	}
	_, err = readMentionRoles(context.Background(), spaceID, func(context.Context, *payload.RelationshipReadRequest) (*payload.RelationshipReadResponse, error) {
		return &payload.RelationshipReadResponse{ContinuousToken: "loop"}, nil
	})
	if err == nil {
		t.Fatal("repeated continuation token accepted")
	}
}

func TestMentionHTTPAccessAndFailures(t *testing.T) {
	spaceID, actor, target, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, tc := range []struct {
		name, path                 string
		status                     int
		anonymous, denied, removed bool
		fail                       string
	}{
		{name: "search", status: 200},
		{name: "details", path: "/" + target.String(), status: 200},
		{name: "non-member target", path: "/" + outsider.String(), status: 404},
		{name: "unknown directory target", path: "/" + target.String(), status: 404, fail: "missing"},
		{name: "inactive target", path: "/" + target.String(), status: 404, fail: "inactive"},
		{name: "unauthenticated", status: 401, anonymous: true},
		{name: "forbidden", status: 403, denied: true},
		{name: "revoked membership", status: 403, removed: true},
		{name: "invalid user", path: "/bad", status: 400},
		{name: "invalid limit", path: "?limit=0", status: 400},
		{name: "invalid escaping", path: "?query=%ZZ", status: 400},
		{name: "permission outage", status: 503, fail: "permission"},
		{name: "membership outage", status: 503, fail: "members"},
		{name: "mapping outage", status: 503, fail: "mapping"},
		{name: "directory outage", status: 503, fail: "directory"},
		{name: "deleted space", status: 404, fail: "space"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			directoryCalls := 0
			api := mentionAPI{
				actor: func(*http.Request) (uuid.UUID, bool) { return actor, !tc.anonymous },
				canView: func(uuid.UUID, uuid.UUID) (bool, error) {
					if tc.fail == "permission" {
						return false, errors.New("private secret")
					}
					return !tc.denied, nil
				},
				service: mentionService{
					members: func(context.Context, uuid.UUID) (map[string]string, error) {
						if tc.fail == "members" {
							return nil, errors.New("private secret")
						}
						if tc.fail == "space" {
							return nil, errMentionSpaceNotFound
						}
						roles := map[string]string{target.String(): "editor"}
						if !tc.removed {
							roles[actor.String()] = "viewer"
						}
						return roles, nil
					},
					identities: func(context.Context, []string) ([]core.ZitaUser, error) {
						directoryCalls++
						if tc.fail == "mapping" {
							return nil, errors.New("private secret")
						}
						return []core.ZitaUser{{UserId: target.String(), Id: "directory-target"}}, nil
					},
					profiles: func(context.Context, []string) ([]core.User, error) {
						if tc.fail == "directory" {
							return nil, errors.New("private secret")
						}
						if tc.fail == "missing" {
							return nil, nil
						}
						profile := mentionProfile("directory-target", "Alex Morgan", "alex@example.com")
						if tc.fail == "inactive" {
							profile.State = "USER_STATE_INACTIVE"
						}
						return []core.User{profile}, nil
					},
				},
			}
			r := chi.NewRouter()
			api.register(r)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", "/"+spaceID.String()+"/mentions/users"+tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status %d want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("profile caching not disabled")
			}
			if strings.Contains(w.Body.String(), "private secret") {
				t.Fatal("provider error exposed")
			}
			if tc.status == 401 || tc.status == 403 || tc.status == 400 || tc.fail == "permission" || tc.name == "non-member target" {
				if directoryCalls != 0 {
					t.Fatal("directory accessed before authorization/validation")
				}
			}
			if tc.status == 200 {
				var response struct {
					Status string          `json:"status"`
					Data   json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Status != "success" {
					t.Fatalf("bad envelope %s", w.Body.String())
				}
				if tc.name == "details" {
					var details MentionUserDetails
					json.Unmarshal(response.Data, &details)
					if details.ID != target.String() || details.SpaceRole != "editor" {
						t.Fatalf("bad detail: %s", response.Data)
					}
				}
			}
		})
	}
	// Exercise the production router's outer authentication middleware too.
	w := httptest.NewRecorder()
	Router().ServeHTTP(w, httptest.NewRequest("GET", "/"+spaceID.String()+"/mentions/users", nil))
	if w.Code != 401 {
		t.Fatalf("production route missing authentication: %d", w.Code)
	}
}
