package editor

import "testing"

func TestDocumentDraftRevision(t *testing.T) {
	current := Document{DocId: 41, DraftGeneration: 7}
	tests := []struct {
		name        string
		expected    *DocumentDraftRevision
		draft, want bool
	}{
		{"matching", &DocumentDraftRevision{41, 7, true}, true, true},
		{"missing", nil, true, false},
		{"stale snapshot", &DocumentDraftRevision{41, 6, true}, true, false},
		{"new draft lineage", &DocumentDraftRevision{40, 7, true}, true, false},
		{"published since fetch", &DocumentDraftRevision{41, 7, true}, false, false},
		{"matching published base", &DocumentDraftRevision{41, 7, false}, false, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := matchesDocumentDraftRevision(test.expected, current, test.draft); got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}

func TestDraftValidationRequiresRevisionAndYjs(t *testing.T) {
	valid := []byte(`{"title":"Document","spaceId":"11111111-1111-1111-1111-111111111111","data":"AAA=","expectedRevision":{"docId":1,"generation":0,"draft":false}}`)
	if _, err := ValidateNewDraftDoc(valid); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{"title":"Document","spaceId":"11111111-1111-1111-1111-111111111111","data":"AAA="}`,
		`{"title":"Document","spaceId":"11111111-1111-1111-1111-111111111111","data":"AQ==","expectedRevision":{"docId":1,"generation":0,"draft":false}}`,
	} {
		if _, err := ValidateNewDraftDoc([]byte(body)); err == nil {
			t.Fatal("invalid draft accepted")
		}
	}
}
