package editor

import (
	"testing"
	"time"

	"github.com/durgakiran/beskar/core"
)

func TestApplyViewAuthorNames(t *testing.T) {
	now := time.Now()
	meta := ViewMeta{createdByID: "creator", updatedByID: "editor", UpdatedAt: &now}
	applyViewAuthorNames(&meta, []core.User{
		{UserId: "creator", Human: core.Human{Profile: core.Profile{DisplayName: "Alice"}}},
		{Id: "editor", Human: core.Human{Profile: core.Profile{GivenName: "Bob", FamilyName: "Smith"}}},
	})
	if meta.CreatedByName == nil || *meta.CreatedByName != "Alice" || meta.UpdatedByName == nil || *meta.UpdatedByName != "Bob Smith" {
		t.Fatalf("unexpected authors: %+v", meta)
	}
}

func TestApplyViewAuthorNamesWithoutPublication(t *testing.T) {
	meta := ViewMeta{createdByID: "creator", updatedByID: "creator"}
	applyViewAuthorNames(&meta, []core.User{{UserId: "creator", Human: core.Human{Profile: core.Profile{DisplayName: "Alice"}}}})
	if meta.CreatedByName == nil || *meta.CreatedByName != "Alice" || meta.UpdatedByName != nil {
		t.Fatalf("unpublished page should only have a creator: %+v", meta)
	}
}
