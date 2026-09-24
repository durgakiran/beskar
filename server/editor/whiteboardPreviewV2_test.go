package editor

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func previewPNG(t *testing.T, red uint8) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	im.Set(0, 0, color.NRGBA{R: red, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestPreviewValidation(t *testing.T) {
	data := previewPNG(t, 255)
	p, err := validateWhiteboardPreview(append(data, []byte("trailing payload")...))
	if err != nil {
		t.Fatal(err)
	}
	if p.Width != 2 || p.Height != 2 || bytes.Contains(p.Bytes, []byte("trailing payload")) {
		t.Fatal("preview not normalized")
	}
	for _, bad := range [][]byte{nil, []byte("<svg/>"), data[:len(data)/2], make([]byte, whiteboardPreviewMaxBytes+1)} {
		if _, err := validateWhiteboardPreview(bad); err == nil {
			t.Fatal("invalid PNG accepted")
		}
	}
	im := image.NewGray(image.Rect(0, 0, 4097, 1))
	var b bytes.Buffer
	_ = png.Encode(&b, im)
	if _, err := validateWhiteboardPreview(b.Bytes()); err == nil {
		t.Fatal("oversize dimensions accepted")
	}
}

type previewHTTPStub struct {
	whiteboardPublisherV2
	preview whiteboardPreview
	calls   int
	err     error
}

func (s *previewHTTPStub) GetPublishedPreview(context.Context, whiteboardDraftInput) (whiteboardPreview, error) {
	s.calls++
	return s.preview, s.err
}
func (s *previewHTTPStub) GetVersionPreview(context.Context, whiteboardDraftInput, uuid.UUID) (whiteboardPreview, error) {
	s.calls++
	return s.preview, s.err
}
func TestPublishedPreviewHTTP(t *testing.T) {
	for _, tc := range []struct {
		query, method string
		status        int
		allowed       bool
	}{
		{"?preview=true", "GET", 200, true}, {"?preview=true", "HEAD", 200, true}, {"?preview=true", "GET", 403, false},
		{"?preview=1", "GET", 400, true}, {"?preview=true&preview=false", "GET", 400, true}, {"?preview=true&x=1", "GET", 400, true},
	} {
		t.Run(tc.method+tc.query+string(rune(tc.status)), func(t *testing.T) {
			p, _ := validateWhiteboardPreview(previewPNG(t, 255))
			stub := &previewHTTPStub{preview: p}
			router := chi.NewRouter()
			d := whiteboardPublishControllerV2{service: stub, user: func(context.Context) (core.UserInfo, error) {
				return core.UserInfo{Id: "user", AId: uuid.NewString()}, nil
			}, permission: func(_ string, _ uuid.UUID, permission string) bool { return tc.allowed && permission == "view" }}
			d.register(router)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(tc.method, "/space/"+uuid.NewString()+"/whiteboard/42/published"+tc.query, nil))
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status == 200 {
				if w.Header().Get("Content-Type") != "image/png" || stub.calls != 1 {
					t.Fatal("did not serve PNG directly")
				}
				if tc.method == "GET" && !bytes.Equal(w.Body.Bytes(), p.Bytes) {
					t.Fatal("wrong bytes")
				}
				if tc.method == "HEAD" && w.Body.Len() != 0 {
					t.Fatal("HEAD body")
				}
			}
			if tc.status != 200 && stub.calls != 0 {
				t.Fatal("invalid request read preview")
			}
		})
	}
}
func publishBodyWithPreview(t *testing.T, body string) string {
	return strings.TrimSuffix(body, "}") + `,"preview":{"contentType":"image/png","data":"` + base64.StdEncoding.EncodeToString(previewPNG(t, 255)) + `"}}`
}
