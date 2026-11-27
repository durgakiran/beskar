package core

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
)

func TestGetBeskarUserCreatesMappingOnFirstRequest(t *testing.T) {
	if os.Getenv("USER_MAPPING_INTEGRATION_TEST") != "true" {
		t.Skip("set USER_MAPPING_INTEGRATION_TEST=true with PG_* for an isolated test database")
	}
	subject := "signup-" + uuid.NewString()[:23]
	t.Cleanup(func() {
		if _, err := GetPool().Exec(context.Background(), "DELETE FROM core.user_id_map WHERE zita_id = $1", subject); err != nil {
			t.Errorf("delete test mapping: %v", err)
		}
	})

	id, err := GetBeskarUser(subject)
	if err != nil {
		t.Fatalf("create first user mapping: %v", err)
	}
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("first request returned an invalid user ID: %v", err)
	}
	existingID, err := GetBeskarUser(subject)
	if err != nil || existingID != id {
		t.Fatalf("second request returned (%q, %v), want (%q, nil)", existingID, err, id)
	}
}

func TestUserSearchResponseAcceptsListDetailsObject(t *testing.T) {
	var response UserSearchResponse
	err := json.Unmarshal([]byte(`{
		"details": {
			"totalResult": 1,
			"processedSequence": 2,
			"timestamp": "2026-04-21T05:13:58Z"
		},
		"result": [
			{
				"userId": "369230162279006216",
				"human": {
					"profile": { "displayName": "Test User" },
					"email": { "email": "test@example.com", "isVerified": true }
				}
			}
		]
	}`), &response)
	if err != nil {
		t.Fatalf("unexpected unmarshal error: %v", err)
	}
	if response.Details.TotalResult != 1 {
		t.Fatalf("expected total result 1, got %d", response.Details.TotalResult)
	}
	if len(response.Result) != 1 {
		t.Fatalf("expected one user result, got %d", len(response.Result))
	}
	if response.Result[0].Human.Profile.DisplayName != "Test User" {
		t.Fatalf("unexpected display name: %q", response.Result[0].Human.Profile.DisplayName)
	}
}

func TestUserSearchResponseAcceptsStringListDetailsValues(t *testing.T) {
	var response UserSearchResponse
	err := json.Unmarshal([]byte(`{
		"details": {
			"totalResult": "1",
			"processedSequence": "2"
		},
		"result": []
	}`), &response)
	if err != nil {
		t.Fatalf("unexpected unmarshal error: %v", err)
	}
	if response.Details.TotalResult != 1 {
		t.Fatalf("expected total result 1, got %d", response.Details.TotalResult)
	}
	if response.Details.ProcessedSequence != 2 {
		t.Fatalf("expected processed sequence 2, got %d", response.Details.ProcessedSequence)
	}
}

func TestUserSearchResponseIgnoresDetailsArray(t *testing.T) {
	var response UserSearchResponse
	err := json.Unmarshal([]byte(`{
		"details": [],
		"result": [
			{
				"userId": "369230162279006216",
				"human": {
					"profile": { "displayName": "Test User" },
					"email": { "email": "test@example.com", "isVerified": true }
				}
			}
		]
	}`), &response)
	if err != nil {
		t.Fatalf("unexpected unmarshal error: %v", err)
	}
	if len(response.Result) != 1 {
		t.Fatalf("expected one user result, got %d", len(response.Result))
	}
	if response.Result[0].Human.Email.Email != "test@example.com" {
		t.Fatalf("unexpected email: %q", response.Result[0].Human.Email.Email)
	}
}

func TestDetectZitadelError(t *testing.T) {
	err := detectZitadelError([]byte(`{
		"code": "permission_denied",
		"message": "missing permission",
		"details": []
	}`))
	if err == nil {
		t.Fatal("expected zitadel error")
	}
	if err.Error() != "missing permission" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSearchUsersByIdsEmptyInput(t *testing.T) {
	response, err := SearchUsersByIds(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if response.Result == nil {
		t.Fatal("expected empty result slice, got nil")
	}
	if len(response.Result) != 0 {
		t.Fatalf("expected no users, got %d", len(response.Result))
	}
}
