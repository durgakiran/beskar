package notificationv2

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AudienceUser struct {
	Email         string
	EmailVerified bool
}
type AudienceDirectory interface {
	Resolve(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error)
}

// ZitadelAudienceDirectory maps Beskar UUIDs to existing identity-provider IDs.
// It never creates identities or searches fuzzy email matches.
type ZitadelAudienceDirectory struct {
	IssuerURL string
	Token     string
	Client    *http.Client
}

func (d *ZitadelAudienceDirectory) Resolve(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, email bool) (map[uuid.UUID]AudienceUser, error) {
	result := map[uuid.UUID]AudienceUser{}
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := tx.Query(ctx, `SELECT user_id,zita_id FROM core.user_id_map WHERE user_id=ANY($1::uuid[]) ORDER BY user_id`, ids)
	if err != nil {
		return nil, fmt.Errorf("directory mapping unavailable")
	}
	mapping := map[string]uuid.UUID{}
	upstream := []string{}
	for rows.Next() {
		var id uuid.UUID
		var zita string
		if err = rows.Scan(&id, &zita); err != nil {
			rows.Close()
			return nil, fmt.Errorf("directory mapping invalid")
		}
		mapping[zita] = id
		upstream = append(upstream, zita)
		if !email {
			result[id] = AudienceUser{}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("directory mapping unavailable")
	}
	if !email {
		return result, nil
	}
	if d.Token == "" || d.IssuerURL == "" {
		return nil, fmt.Errorf("directory configuration missing")
	}
	client := d.Client
	if client == nil {
		client = http.DefaultClient
	}
	// The existing user-search contract limits by explicit IDs. Small batches avoid
	// truncation and make missing users distinguishable from request failures.
	for start := 0; start < len(upstream); start += 10 {
		end := min(start+10, len(upstream))
		body, _ := json.Marshal(core.UserSearchQuery{Query: core.Query{Limit: 10}, Queries: []core.Filter{{InUserIdsQuery: &core.InUserIdsQUeryFilter{UserIds: upstream[start:end]}}}})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(d.IssuerURL, "/")+"/v2/users", bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("directory configuration invalid")
		}
		req.Header.Set("Authorization", "Bearer "+d.Token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("directory request failed")
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
		resp.Body.Close()
		if readErr != nil || len(raw) > 2*1024*1024 || resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("directory response unavailable")
		}
		var out core.UserSearchResponse
		if json.Unmarshal(raw, &out) != nil {
			return nil, fmt.Errorf("directory response invalid")
		}
		var envelope map[string]json.RawMessage
		if json.Unmarshal(raw, &envelope) != nil || envelope == nil {
			return nil, fmt.Errorf("directory response invalid")
		}
		if code, ok := envelope["code"]; ok && string(code) != "0" {
			return nil, fmt.Errorf("directory response unavailable")
		}
		if out.Details.TotalResult > int64(len(out.Result)) {
			return nil, fmt.Errorf("directory result truncated")
		}
		// Do not expose provider responses, addresses or credentials through job errors.
		for _, u := range out.Result {
			zita := u.UserId
			if zita == "" {
				zita = u.Id
			}
			if id, ok := mapping[zita]; ok {
				result[id] = AudienceUser{Email: u.Human.Email.Email, EmailVerified: u.Human.Email.IsVerified}
			}
		}
	}
	return result, nil
}
