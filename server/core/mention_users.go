package core

import (
	"context"
	"os"
	"strings"
)

// IsActiveHuman accepts the v2 response shape where human.userId is omitted.
// Machine accounts have no human profile/email fields. A usable profile is
// required; missing/unknown account states remain unavailable.
func (user User) IsActiveHuman() bool {
	state := user.State
	if state == "" || state == "USER_STATE_UNSPECIFIED" {
		state = user.Human.State
	}
	human := user.Human
	hasProfile := strings.TrimSpace(human.Profile.DisplayName+human.Profile.GivenName+human.Profile.FamilyName+human.Email.Email) != ""
	return state == "USER_STATE_ACTIVE" && hasProfile
}

// SearchMentionUsersByIds reads only supplied directory IDs, following all
// pages even if the provider caps its page size below the requested limit.
func SearchMentionUsersByIds(ctx context.Context, ids []string) ([]User, error) {
	result := make([]User, 0)
	seen := make(map[string]bool)
	for start := 0; start < len(ids); start += 50 {
		end := start + 50
		if end > len(ids) {
			end = len(ids)
		}
		allowed := make(map[string]bool)
		for _, id := range ids[start:end] {
			allowed[id] = true
		}
		query := UserSearchQuery{
			Query:         Query{Limit: 50, ASC: true},
			SortingColumn: "USER_FIELD_NAME_USER_NAME",
			Queries:       []Filter{{InUserIdsQuery: &InUserIdsQUeryFilter{UserIds: ids[start:end]}}},
		}
		for {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			page, err := runUserSearchContext(ctx, normalizeExternalURL(os.Getenv("ISSUER_URL")), query)
			if err != nil {
				return nil, err
			}
			if len(page.Result) == 0 {
				break
			}
			for _, user := range page.Result {
				if allowed[user.UserId] && !seen[user.UserId] && user.IsActiveHuman() {
					result = append(result, user)
					seen[user.UserId] = true
				}
			}
			query.Query.Offset += uint64(len(page.Result))
			if page.Details.TotalResult > 0 && query.Query.Offset >= uint64(page.Details.TotalResult) {
				break
			}
		}
	}
	return result, nil
}
