package editor

import (
	"strings"
	"testing"
)

func TestValidateWhiteboardCreateV2(t *testing.T) {
	for _, body := range []string{
		`null`, `{}`, `[]`, `{"title":"  "}`, `{"title":42}`, `{"title":"x","parentId":0}`,
		`{"title":"x","parentId":-1}`, `{"title":"x","parentId":1.5}`, `{"title":"x","parentId":9007199254740992}`,
		`{"title":"x","ownerId":"injected"}`, `{"title":"x"} {}`, `{"title":"x\u0000"}`,
		`{"title":"` + strings.Repeat("界", 256) + `"}`, string([]byte{'{', '"', 0xff}),
	} {
		t.Run(body, func(t *testing.T) {
			if _, err := validateWhiteboardCreateV2([]byte(body)); err == nil {
				t.Fatal("accepted invalid request")
			}
		})
	}
	a, err := validateWhiteboardCreateV2([]byte(`{"title":"  Architecture discussion  "}`))
	if err != nil || a.Title != "Architecture discussion" || a.ParentID != nil {
		t.Fatalf("unexpected normalized body: %+v, %v", a, err)
	}
	b, err := validateWhiteboardCreateV2([]byte(`{"parentId":null,"title":"Architecture discussion"}`))
	if err != nil || whiteboardCreateV2Hash(a) != whiteboardCreateV2Hash(b) {
		t.Fatal("equivalent requests must share a hash")
	}
	b.ParentID = new(int64)
	*b.ParentID = 123
	if whiteboardCreateV2Hash(a) == whiteboardCreateV2Hash(b) {
		t.Fatal("parent must be included in request hash")
	}
	if _, err := validateWhiteboardCreateV2([]byte(`{"title":"` + strings.Repeat("界", 255) + `"}`)); err != nil {
		t.Fatalf("title length must count characters: %v", err)
	}
}
