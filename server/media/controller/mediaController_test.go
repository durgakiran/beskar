package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/durgakiran/beskar/core"
	mediaservice "github.com/durgakiran/beskar/media/services"
	"github.com/google/uuid"
)

func TestWhiteboardAssetDeliveryHeadersAreRestrictiveAndImmutable(t *testing.T) {
	header := make(http.Header)
	record := &mediaservice.WhiteboardAssetRecord{
		ContentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		MimeType:    "image/png",
	}
	applyWhiteboardAssetHeaders(header, record, 128)

	expected := map[string]string{
		"Content-Type":                 "image/png",
		"X-Content-Type-Options":       "nosniff",
		"Content-Security-Policy":      "default-src 'none'; sandbox",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Referrer-Policy":              "no-referrer",
		"Cache-Control":                "private, max-age=31536000, immutable",
		"Content-Length":               "128",
	}
	for key, value := range expected {
		if got := header.Get(key); got != value {
			t.Fatalf("%s = %q, want %q", key, got, value)
		}
	}
}

func TestWhiteboardAssetRoutesRejectCrossPageAccessBeforeLookup(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{
			Id:  "external-user",
			AId: "11111111-1111-1111-1111-111111111111",
		}, nil
	}
	var permissionPage string
	validateUserPagePermission = func(pageID string, _ uuid.UUID, permission string) bool {
		permissionPage = pageID + ":" + permission
		return false
	}

	request := httptest.NewRequest(http.MethodGet,
		"/whiteboard-asset/42/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		nil,
	)
	response := httptest.NewRecorder()
	Router().ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if permissionPage != "42:view" {
		t.Fatalf("permission check = %q, want page-scoped view check", permissionPage)
	}
}
