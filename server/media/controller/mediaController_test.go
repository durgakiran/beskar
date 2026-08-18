package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	mediaservice "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"
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

func TestParseCanonicalWhiteboardAssetIDRequiresFullPrefixAndLowerHex(t *testing.T) {
	validHash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if hash, ok := parseCanonicalWhiteboardAssetID("asset:sha256:" + validHash); !ok || hash != validHash {
		t.Fatalf("canonical asset id rejected: %q %v", hash, ok)
	}
	for _, value := range []string{
		validHash,
		"sha256:" + validHash,
		"asset:sha256:" + "A" + validHash[1:],
		"asset:sha256:" + "z" + validHash[1:],
		"prefixasset:sha256:" + validHash,
	} {
		if _, ok := parseCanonicalWhiteboardAssetID(value); ok {
			t.Fatalf("non-canonical asset id accepted: %q", value)
		}
	}
}

func TestWhiteboardAssetRollbackRouteIsAuthenticatedAndReferenceSafe(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalRollback := rollbackWhiteboardAsset
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		rollbackWhiteboardAsset = originalRollback
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: "11111111-1111-1111-1111-111111111111"}, nil
	}
	validateUserPagePermission = func(pageID string, _ uuid.UUID, permission string) bool {
		return pageID == "42" && permission == "edit"
	}
	rollbackWhiteboardAsset = func(context.Context, int64, string, string) error {
		return mediaservice.ErrWhiteboardAssetReferenced
	}
	request := httptest.NewRequest(http.MethodDelete,
		"/whiteboard-asset/42/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	response := httptest.NewRecorder()
	Router().ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	rollbackWhiteboardAsset = func(context.Context, int64, string, string) error { return errors.New("storage") }
	response = httptest.NewRecorder()
	Router().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
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

func TestWhiteboardStagingAndRetainRoutesRejectAuthorizationBeforeService(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalPrepare := prepareWhiteboardStaging
	originalStage := stageWhiteboardAsset
	originalCommit := commitWhiteboardStaging
	originalCancel := cancelWhiteboardStaging
	originalRetain := retainWhiteboardAssets
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		prepareWhiteboardStaging = originalPrepare
		stageWhiteboardAsset = originalStage
		commitWhiteboardStaging = originalCommit
		cancelWhiteboardStaging = originalCancel
		retainWhiteboardAssets = originalRetain
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "denied", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(string, uuid.UUID, string) bool { return false }
	serviceCalls := 0
	prepareWhiteboardStaging = func(context.Context, int64, string, string) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		serviceCalls++
		return nil, nil
	}
	stageWhiteboardAsset = func(context.Context, uuid.UUID, int64, string, string, mediaservice.InspectedRaster, []byte) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		serviceCalls++
		return nil, nil
	}
	commitWhiteboardStaging = func(context.Context, uuid.UUID, int64, string, string) (*mediaservice.WhiteboardAssetRecord, bool, error) {
		serviceCalls++
		return nil, false, nil
	}
	cancelWhiteboardStaging = func(context.Context, uuid.UUID, int64, string, string) error {
		serviceCalls++
		return nil
	}
	retainWhiteboardAssets = func(context.Context, int64, int64, []string) error {
		serviceCalls++
		return nil
	}

	hash := strings.Repeat("a", 64)
	token := "66666666-6666-4666-8666-666666666666"
	routes := []struct{ method, path, body string }{
		{http.MethodPost, "/whiteboard-asset/42/" + hash + "/staging", ""},
		{http.MethodPut, "/whiteboard-asset/42/" + hash + "/staging/" + token, "not-an-image"},
		{http.MethodPost, "/whiteboard-asset/42/" + hash + "/staging/" + token + "/commit", ""},
		{http.MethodDelete, "/whiteboard-asset/42/" + hash + "/staging/" + token, ""},
		{http.MethodPost, "/whiteboard-asset/42/retain", `{not-json`},
	}
	for _, route := range routes {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(route.method, route.path, strings.NewReader(route.body))
		Router().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s %s status=%d, want forbidden", route.method, route.path, response.Code)
		}
	}
	if serviceCalls != 0 {
		t.Fatalf("authorization denial invoked %d staging/retain service dependencies", serviceCalls)
	}
}

func TestWhiteboardAssetAuthorizationUsesOneValidatedIdentity(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalPrepare := prepareWhiteboardStaging
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		prepareWhiteboardStaging = originalPrepare
	})
	identityCalls := 0
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		identityCalls++
		return core.UserInfo{Id: "user", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(string, uuid.UUID, string) bool { return true }
	prepareWhiteboardStaging = func(_ context.Context, _ int64, _ string, actorID string) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		if actorID != "77777777-7777-4777-8777-777777777777" {
			t.Fatalf("validated actor changed before service call: %q", actorID)
		}
		return &mediaservice.WhiteboardAssetStagingRecord{Token: uuid.New()}, nil
	}
	request := httptest.NewRequest(http.MethodPost, "/whiteboard-asset/42/"+strings.Repeat("a", 64)+"/staging", nil)
	response := httptest.NewRecorder()
	Router().ServeHTTP(response, request)
	if response.Code != http.StatusCreated || identityCalls != 1 {
		t.Fatalf("status=%d identity calls=%d, want one authenticated identity lookup", response.Code, identityCalls)
	}
}

func TestWhiteboardCommitRejectsNilRecordAndCompensatedReplay(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalCommit := commitWhiteboardStaging
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		commitWhiteboardStaging = originalCommit
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(string, uuid.UUID, string) bool { return true }
	hash := strings.Repeat("a", 64)
	token := uuid.New()
	for _, commit := range []func(context.Context, uuid.UUID, int64, string, string) (*mediaservice.WhiteboardAssetRecord, bool, error){
		func(context.Context, uuid.UUID, int64, string, string) (*mediaservice.WhiteboardAssetRecord, bool, error) {
			return nil, false, nil
		},
		func(context.Context, uuid.UUID, int64, string, string) (*mediaservice.WhiteboardAssetRecord, bool, error) {
			return nil, false, mediaservice.ErrWhiteboardAssetCompensated
		},
	} {
		commitWhiteboardStaging = commit
		response := httptest.NewRecorder()
		Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/whiteboard-asset/42/"+hash+"/staging/"+token.String()+"/commit", nil))
		if response.Code != http.StatusConflict {
			t.Fatalf("compensated/nil commit status=%d, want conflict", response.Code)
		}
	}
}

func TestStageFailureCompensatesWithIndependentContext(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalStage := stageWhiteboardAsset
	originalCancel := cancelWhiteboardStaging
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		stageWhiteboardAsset = originalStage
		cancelWhiteboardStaging = originalCancel
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(string, uuid.UUID, string) bool { return true }
	stageWhiteboardAsset = func(ctx context.Context, _ uuid.UUID, _ int64, _, _ string, _ mediaservice.InspectedRaster, _ []byte) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		if ctx.Err() == nil {
			t.Fatal("stage must receive the cancelled request context")
		}
		return nil, context.Canceled
	}
	compensated := false
	cancelWhiteboardStaging = func(ctx context.Context, _ uuid.UUID, _ int64, _, _ string) error {
		if ctx.Err() != nil {
			t.Fatalf("compensation inherited cancelled context: %v", ctx.Err())
		}
		compensated = true
		return nil
	}
	var encoded bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 1, 1))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	pngBytes := encoded.Bytes()
	digest := sha256.Sum256(pngBytes)
	hash := hex.EncodeToString(digest[:])
	token := "66666666-6666-4666-8666-666666666666"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodPut,
		"/whiteboard-asset/42/"+hash+"/staging/"+token, bytes.NewReader(pngBytes)).WithContext(ctx)
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	Router().ServeHTTP(response, request)
	if !compensated {
		t.Fatal("stage failure did not invoke independent compensation")
	}
}

func TestWhiteboardStagingRoutesCoverSuccessfulLifecycle(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalPrepare := prepareWhiteboardStaging
	originalStage := stageWhiteboardAsset
	originalCommit := commitWhiteboardStaging
	originalCancel := cancelWhiteboardStaging
	originalRetain := retainWhiteboardAssets
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		prepareWhiteboardStaging = originalPrepare
		stageWhiteboardAsset = originalStage
		commitWhiteboardStaging = originalCommit
		cancelWhiteboardStaging = originalCancel
		retainWhiteboardAssets = originalRetain
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(pageID string, _ uuid.UUID, permission string) bool {
		return pageID == "42" && permission == "edit"
	}
	token := uuid.MustParse("66666666-6666-4666-8666-666666666666")
	hash := strings.Repeat("a", 64)
	prepareWhiteboardStaging = func(context.Context, int64, string, string) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		return &mediaservice.WhiteboardAssetStagingRecord{Token: token}, nil
	}
	stageWhiteboardAsset = func(_ context.Context, gotToken uuid.UUID, pageID int64, gotHash, actor string, inspected mediaservice.InspectedRaster, data []byte) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		if gotToken != token || pageID != 42 || gotHash != hash || actor == "" || inspected.ContentHash != hash || len(data) == 0 {
			t.Fatalf("unexpected stage request: %s %d %s %s %#v", gotToken, pageID, gotHash, actor, inspected)
		}
		return &mediaservice.WhiteboardAssetStagingRecord{Token: token}, nil
	}
	created := true
	commitWhiteboardStaging = func(context.Context, uuid.UUID, int64, string, string) (*mediaservice.WhiteboardAssetRecord, bool, error) {
		return &mediaservice.WhiteboardAssetRecord{ContentHash: hash, MimeType: "image/png", Width: 1, Height: 1, FileSize: 70}, created, nil
	}
	cancelWhiteboardStaging = func(context.Context, uuid.UUID, int64, string, string) error { return nil }
	retainWhiteboardAssets = func(_ context.Context, pageID, documentID int64, hashes []string) error {
		if pageID != 42 || documentID != 9 || len(hashes) != 1 || hashes[0] != hash {
			t.Fatalf("unexpected retention request: %d %d %v", pageID, documentID, hashes)
		}
		return nil
	}

	request := func(method, path string, body *bytes.Reader) *httptest.ResponseRecorder {
		var source io.Reader = http.NoBody
		if body != nil {
			source = io.NopCloser(body)
		}
		r := httptest.NewRequest(method, path, source)
		response := httptest.NewRecorder()
		Router().ServeHTTP(response, r)
		return response
	}
	if response := request(http.MethodPost, "/whiteboard-asset/42/"+hash+"/staging", nil); response.Code != http.StatusCreated {
		t.Fatalf("prepare status = %d", response.Code)
	}
	var encoded bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 1, 1))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	pngBytes := encoded.Bytes()
	digest := sha256.Sum256(pngBytes)
	hash = hex.EncodeToString(digest[:])
	stageRequest := httptest.NewRequest(http.MethodPut, "/whiteboard-asset/42/"+hash+"/staging/"+token.String(), bytes.NewReader(pngBytes))
	stageRequest.Header.Set("Content-Type", "image/png")
	stageResponse := httptest.NewRecorder()
	Router().ServeHTTP(stageResponse, stageRequest)
	if stageResponse.Code != http.StatusNoContent {
		t.Fatalf("stage status = %d: %s", stageResponse.Code, stageResponse.Body.String())
	}

	for _, want := range []int{http.StatusCreated, http.StatusOK} {
		response := request(http.MethodPost, "/whiteboard-asset/42/"+hash+"/staging/"+token.String()+"/commit", nil)
		if response.Code != want {
			t.Fatalf("commit status = %d, want %d", response.Code, want)
		}
		created = false
	}
	if response := request(http.MethodDelete, "/whiteboard-asset/42/"+hash+"/staging/"+token.String(), nil); response.Code != http.StatusNoContent {
		t.Fatalf("cancel status = %d", response.Code)
	}
	body := bytes.NewBufferString(`{"assetIds":["asset:sha256:` + hash + `"],"context":{"documentId":"9"}}`)
	retainRequest := httptest.NewRequest(http.MethodPost, "/whiteboard-asset/42/retain", body)
	retainResponse := httptest.NewRecorder()
	Router().ServeHTTP(retainResponse, retainRequest)
	if retainResponse.Code != http.StatusNoContent {
		t.Fatalf("retain status = %d: %s", retainResponse.Code, retainResponse.Body.String())
	}
}

func TestWhiteboardStagingRoutesRejectMalformedInputsAndMapErrors(t *testing.T) {
	originalGetUser := getUserInfoForMedia
	originalPermission := validateUserPagePermission
	originalPrepare := prepareWhiteboardStaging
	t.Cleanup(func() {
		getUserInfoForMedia = originalGetUser
		validateUserPagePermission = originalPermission
		prepareWhiteboardStaging = originalPrepare
	})
	getUserInfoForMedia = func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: "77777777-7777-4777-8777-777777777777"}, nil
	}
	validateUserPagePermission = func(string, uuid.UUID, string) bool { return true }
	prepareWhiteboardStaging = func(context.Context, int64, string, string) (*mediaservice.WhiteboardAssetStagingRecord, error) {
		return nil, mediaservice.ErrWhiteboardAssetNotFound
	}
	hash := strings.Repeat("a", 64)
	for _, path := range []string{
		"/whiteboard-asset/42/bad/staging",
		"/whiteboard-asset/42/" + hash + "/staging/not-a-uuid/commit",
	} {
		response := httptest.NewRecorder()
		Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d", path, response.Code)
		}
	}
	response := httptest.NewRecorder()
	Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/whiteboard-asset/42/"+hash+"/staging", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("prepare error status = %d", response.Code)
	}

	for _, tc := range []struct {
		err    error
		status int
	}{
		{mediaservice.ErrWhiteboardAssetNotFound, http.StatusNotFound},
		{mediaservice.ErrWhiteboardAssetNotOwner, http.StatusForbidden},
		{mediaservice.ErrWhiteboardAssetCompensated, http.StatusConflict},
		{quota.ErrAccountStorageLimitExceeded, http.StatusInsufficientStorage},
		{errors.New("hash does not match"), http.StatusConflict},
		{errors.New("transaction is closed"), http.StatusConflict},
		{errors.New("storage failed"), http.StatusInternalServerError},
	} {
		w := httptest.NewRecorder()
		renderWhiteboardStagingError(w, tc.err)
		if w.Code != tc.status {
			t.Fatalf("error %q status = %d, want %d", tc.err, w.Code, tc.status)
		}
	}
}
