package space

import "testing"

func TestValidateMovePageRequest(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `[]`, `{"parentId":0}`, `{"parentId":-1}`, `{"parentId":1.5}`, `{"parentId":"2"}`, `{"parentId":9007199254740992}`, `{"parentId":2,"spaceId":"other"}`, `{"parentId":2} {}`} {
		t.Run(body, func(t *testing.T) {
			if _, err := validateMovePageRequest([]byte(body)); err == nil {
				t.Fatal("expected invalid move request")
			}
		})
	}
	req, err := validateMovePageRequest([]byte(`{"parentId":null}`))
	if err != nil || req.ParentId != nil {
		t.Fatalf("root move: %v, %v", req.ParentId, err)
	}
	req, err = validateMovePageRequest([]byte(`{"parentId":42}`))
	if err != nil || req.ParentId == nil || *req.ParentId != 42 {
		t.Fatalf("nested move: %v, %v", req.ParentId, err)
	}
}

func TestValidateReorderPageRequest(t *testing.T) {
	for _, body := range []string{
		`{}`, `null`, `[]`, `{"targetPageId":2}`, `{"placement":"before"}`,
		`{"targetPageId":0,"placement":"before"}`, `{"targetPageId":-1,"placement":"before"}`,
		`{"targetPageId":1.5,"placement":"before"}`, `{"targetPageId":"2","placement":"before"}`,
		`{"targetPageId":9007199254740992,"placement":"before"}`, `{"targetPageId":2,"placement":"inside"}`,
		`{"targetPageId":2,"placement":"before","parentId":4}`, `{"targetPageId":2,"placement":"before"} {}`,
	} {
		t.Run(body, func(t *testing.T) {
			if _, err := validateReorderPageRequest([]byte(body)); err == nil {
				t.Fatal("expected invalid reorder request")
			}
		})
	}
	for _, placement := range []string{"before", "after"} {
		req, err := validateReorderPageRequest([]byte(`{"targetPageId":42,"placement":"` + placement + `"}`))
		if err != nil || req.TargetPageId != 42 || req.Placement != placement {
			t.Fatalf("valid reorder: %v, %v", req, err)
		}
	}
}

func TestValidateAnchoredMovePageRequest(t *testing.T) {
	for _, body := range []string{
		`{"parentId":null,"targetPageId":2}`, `{"parentId":1,"placement":"before"}`,
		`{"parentId":1,"targetPageId":null,"placement":"before"}`, `{"parentId":1,"targetPageId":0,"placement":"before"}`,
		`{"parentId":1,"targetPageId":2,"placement":null}`, `{"parentId":1,"targetPageId":2,"placement":"inside"}`,
		`{"parentId":1,"targetPageId":9007199254740992,"placement":"after"}`,
	} {
		if _, err := validateMovePageRequest([]byte(body)); err == nil {
			t.Fatalf("invalid anchored move accepted: %s", body)
		}
	}
	for _, placement := range []string{"before", "after"} {
		req, err := validateMovePageRequest([]byte(`{"parentId":null,"targetPageId":42,"placement":"` + placement + `"}`))
		if err != nil || req.ParentId != nil || req.TargetPageId == nil || *req.TargetPageId != 42 || req.Placement != placement {
			t.Fatalf("anchored move: %v, %v", req, err)
		}
	}
}
