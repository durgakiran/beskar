package notificationv2

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func testCredential(source, token string) credentialConfig {
	h := sha256.Sum256([]byte(token))
	return credentialConfig{source, uuid.New(), hex.EncodeToString(h[:])}
}
func TestProducerCredentials(t *testing.T) {
	token := strings.Repeat("test-secret-", 4)
	entry := testCredential("document-service", token)
	raw, _ := json.Marshal([]credentialConfig{entry})
	resolve, err := ParseProducerCredentials(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/?source_service=forged", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	p, err := resolve(request)
	if err != nil || p.Source != entry.Source || p.ActorID != entry.ActorID {
		t.Fatal("server identity was not used", p, err)
	}
	for _, header := range []string{"", "Basic " + token, "Bearer short", "Bearer " + strings.Repeat("x", 40)} {
		request.Header.Set("Authorization", header)
		_, err = resolve(request)
		var e *Error
		if !errors.As(err, &e) || e.Status != 401 {
			t.Fatalf("accepted header %q", header)
		}
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Add("Authorization", "Bearer "+token)
	if _, err = resolve(request); err == nil {
		t.Fatal("accepted duplicate Authorization")
	}
	duplicate, _ := json.Marshal([]credentialConfig{entry, entry})
	if _, err = ParseProducerCredentials(string(duplicate)); err == nil {
		t.Fatal("accepted shared credential")
	}
	for _, bad := range []string{`{}`, string(raw) + ` []`, `[{"source":"x","actor_id":"invalid","token_sha256":"redacted"}]`} {
		if _, err = ParseProducerCredentials(bad); err == nil {
			t.Fatal("accepted invalid configuration")
		}
	}
	resolve, err = ParseProducerCredentials("")
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolve(request)
	var e *Error
	if !errors.As(err, &e) || e.Status != 503 {
		t.Fatal("empty configuration must deny access")
	}
}
func TestHTTPRejectsUnauthenticatedProducer(t *testing.T) {
	token := strings.Repeat("test-only-", 4)
	entry := testCredential("internal", token)
	raw, _ := json.Marshal([]credentialConfig{entry})
	resolve, _ := ParseProducerCredentials(string(raw))
	// A nil service makes this test fail loudly if authentication is bypassed.
	router := NewController(nil, resolve).Router()
	for _, path := range []string{"/", "/" + uuid.NewString(), "/" + uuid.NewString() + "/cancel"} {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		r.AddCookie(&http.Cookie{Name: "zitadel.session", Value: "a-browser-session"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 401 || w.Header().Get("WWW-Authenticate") == "" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unprotected route %s: %d", path, w.Code)
		}
	}
}
