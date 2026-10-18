package editor

import (
	"context"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
)

// Directory outages must not prevent viewing published content.
func resolveViewAuthors(ctx context.Context, meta *ViewMeta) {
	unknown := "Unknown user"
	meta.CreatedByName = &unknown
	if meta.UpdatedAt != nil {
		meta.UpdatedByName = &unknown
	}
	ids := []string{}
	if meta.createdByID != "" {
		ids = append(ids, meta.createdByID)
	}
	if meta.updatedByID != "" && meta.updatedByID != meta.createdByID {
		ids = append(ids, meta.updatedByID)
	}
	if len(ids) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	users, err := core.SearchUsersByIdsContext(ctx, ids)
	if err != nil {
		logger().Warn("Unable to resolve page authors: " + err.Error())
		return
	}
	applyViewAuthorNames(meta, users.Result)
}

func applyViewAuthorNames(meta *ViewMeta, users []core.User) {
	for _, user := range users {
		id := user.UserId
		if id == "" {
			id = user.Id
		}
		name := strings.TrimSpace(user.Human.Profile.DisplayName)
		if name == "" {
			name = strings.TrimSpace(user.Human.Profile.GivenName + " " + user.Human.Profile.FamilyName)
		}
		if name == "" {
			continue
		}
		if id == meta.createdByID {
			meta.CreatedByName = &name
		}
		if id == meta.updatedByID && meta.UpdatedAt != nil {
			meta.UpdatedByName = &name
		}
	}
}
