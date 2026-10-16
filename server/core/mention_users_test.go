package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func activeMentionDirectoryUser(id string) User {
	return User{UserId: id, State: "USER_STATE_ACTIVE", Human: Human{UserId: id, Profile: Profile{DisplayName: id}}}
}

func TestMentionDirectoryPaginationAndScope(t *testing.T) {
	ids := make([]string, 53)
	for i := range ids {
		ids[i] = fmt.Sprintf("directory-%02d", i)
	}
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/v2/users" || r.Header.Get("Authorization") != "Bearer test-pat" {
			t.Errorf("unexpected directory request %s %s", r.Method, r.URL.Path)
		}
		var query UserSearchQuery
		if err := json.NewDecoder(r.Body).Decode(&query); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if len(query.Queries) != 1 || query.Queries[0].InUserIdsQuery == nil {
			t.Error("unscoped directory query")
			w.WriteHeader(400)
			return
		}
		allowed := query.Queries[0].InUserIdsQuery.UserIds
		if len(allowed) > 50 || query.Query.Limit != 50 || query.SortingColumn != "USER_FIELD_NAME_USER_NAME" {
			t.Error("bad directory chunk")
		}
		start := int(query.Query.Offset)
		end := start + 7 // Provider imposes a smaller page limit.
		if end > len(allowed) {
			end = len(allowed)
		}
		users := []User{}
		for _, id := range allowed[start:end] {
			users = append(users, activeMentionDirectoryUser(id))
		}
		json.NewEncoder(w).Encode(UserSearchResponse{Details: Details{TotalResult: int64(len(allowed))}, Result: users})
	}))
	defer provider.Close()
	t.Setenv("ISSUER_URL", provider.URL)
	t.Setenv("SERVER_PAT", "test-pat")
	users, err := SearchMentionUsersByIds(context.Background(), ids)
	if err != nil || len(users) != 53 || calls != 9 {
		t.Fatalf("truncated directory lookup: users=%d calls=%d err=%v", len(users), calls, err)
	}
	got := make([]string, len(users))
	for i, user := range users {
		got[i] = user.UserId
	}
	if !reflect.DeepEqual(got, ids) {
		t.Fatalf("wrong users: %v", got)
	}
}

func TestMentionDirectoryExcludesUnavailableAndUnrequestedUsers(t *testing.T) {
	inactive := activeMentionDirectoryUser("inactive")
	inactive.State = "USER_STATE_INACTIVE"
	deleted := activeMentionDirectoryUser("deleted")
	deleted.State = "USER_STATE_DELETED"
	locked := activeMentionDirectoryUser("locked")
	locked.State = "USER_STATE_LOCKED"
	unknown := activeMentionDirectoryUser("unknown")
	unknown.State = ""
	machine := activeMentionDirectoryUser("machine")
	machine.Human = Human{}
	legacy := activeMentionDirectoryUser("legacy")
	legacy.State = ""
	legacy.Human.State = "USER_STATE_ACTIVE"
	users := []User{activeMentionDirectoryUser("active"), inactive, deleted, locked, unknown, machine, legacy, activeMentionDirectoryUser("outsider"), activeMentionDirectoryUser("active")}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(UserSearchResponse{Details: Details{TotalResult: int64(len(users))}, Result: users})
	}))
	defer provider.Close()
	t.Setenv("ISSUER_URL", provider.URL)
	result, err := SearchMentionUsersByIds(context.Background(), []string{"active", "inactive", "deleted", "locked", "unknown", "machine", "legacy"})
	if err != nil || len(result) != 2 || result[0].UserId != "active" || result[1].UserId != "legacy" {
		t.Fatalf("unexpected directory users: %+v %v", result, err)
	}
}

func TestMentionDirectoryFailureDoesNotReturnPartialResults(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 2 {
			w.WriteHeader(503)
			w.Write([]byte(`{"message":"private provider details","code":"unavailable"}`))
			return
		}
		json.NewEncoder(w).Encode(UserSearchResponse{Details: Details{TotalResult: 2}, Result: []User{activeMentionDirectoryUser("one")}})
	}))
	defer provider.Close()
	t.Setenv("ISSUER_URL", provider.URL)
	result, err := SearchMentionUsersByIds(context.Background(), []string{"one", "two"})
	if err == nil || result != nil || calls != 2 {
		t.Fatalf("partial directory returned: %v %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = SearchMentionUsersByIds(ctx, []string{"one"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation ignored: %v", err)
	}
	result, err = SearchMentionUsersByIds(context.Background(), nil)
	if err != nil || result == nil || len(result) != 0 || calls != 2 {
		t.Fatal("empty IDs caused directory query")
	}
}

func TestMentionDirectoryRejectsInvalidSuccessResponses(t *testing.T) {
	for _, body := range []string{"null", "not json", `{"code":"unavailable","message":"directory failed"}`} {
		t.Run(body, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
			defer provider.Close()
			t.Setenv("ISSUER_URL", provider.URL)
			users, err := SearchMentionUsersByIds(context.Background(), []string{"one"})
			if err == nil || users != nil {
				t.Fatalf("invalid success returned as missing user: %v %v", users, err)
			}
		})
	}
}

func TestMentionDirectoryAcceptsV2HumanWithoutNestedUserID(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"details":{"totalResult":2},"result":[{"userId":"human-one","state":"USER_STATE_ACTIVE","human":{"profile":{"displayName":"Real User"},"email":{"email":"real@example.com"}}},{"userId":"service-one","state":"USER_STATE_ACTIVE","machine":{"name":"Service account"}}]}`))
	}))
	defer provider.Close()
	t.Setenv("ISSUER_URL", provider.URL)
	users, err := SearchMentionUsersByIds(context.Background(), []string{"human-one", "service-one"})
	if err != nil || len(users) != 1 || users[0].UserId != "human-one" {
		t.Fatalf("unexpected v2 profiles: %+v %v", users, err)
	}
}
