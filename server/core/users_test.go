package core

import (
	"encoding/json"
	"testing"
)

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
