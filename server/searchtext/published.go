package searchtext

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Metadata struct {
	SpaceID   uuid.UUID `json:"spaceId"`
	CreatedBy uuid.UUID `json:"createdBy"`
	PageID    int64     `json:"pageId"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type PublishedNodes struct {
	Metadata
	DocumentNodes
}

type PublishedDocument struct {
	Metadata
	DocID    int64  `json:"docId"`
	BodyText string `json:"bodyText"`
}

func (input PublishedNodes) Generate() (PublishedDocument, error) {
	if input.PageID <= 0 || input.DocID <= 0 || input.SpaceID == uuid.Nil || input.CreatedBy == uuid.Nil || input.CreatedAt.IsZero() || input.UpdatedAt.IsZero() {
		return PublishedDocument{}, &Error{Kind: "invalid_metadata", DocID: input.DocID, Detail: "required publication metadata is missing"}
	}
	// Page creation historically stores a published title row without any body
	// rows. Recognize that representation only at the publication boundary.
	// Nonempty malformed trees still go through strict extraction; draft state
	// is never a source or fallback for a published document's body.
	var body string
	if len(input.Content) != 0 || len(input.Text) != 0 {
		var err error
		body, err = Extract(input.DocumentNodes)
		if err != nil {
			return PublishedDocument{}, err
		}
	}
	metadata := input.Metadata
	metadata.CreatedAt = metadata.CreatedAt.UTC()
	metadata.UpdatedAt = metadata.UpdatedAt.UTC()
	return PublishedDocument{Metadata: metadata, DocID: input.DocID, BodyText: body}, nil
}

// DecodePublished rejects null/missing sibling positions instead of coercing
// them into Go's zero value. Unknown fields (including editor marks) are allowed.
func DecodePublished(data []byte) (PublishedNodes, error) {
	var input PublishedNodes
	if !utf8.Valid(data) {
		return input, fmt.Errorf("publication JSON contains invalid UTF-8")
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return input, fmt.Errorf("decode publication: %w", err)
	}
	var required struct {
		Content []struct {
			Order *int64 `json:"orderId"`
		} `json:"content"`
		Text []struct {
			Order *int64  `json:"orderId"`
			Text  *string `json:"text"`
		} `json:"text"`
	}
	if err := json.Unmarshal(data, &required); err != nil {
		return input, err
	}
	for _, node := range required.Content {
		if node.Order == nil {
			return input, &Error{Kind: "invalid_node", DocID: input.DocID, Detail: "missing content order"}
		}
	}
	for _, node := range required.Text {
		if node.Order == nil || node.Text == nil {
			return input, &Error{Kind: "invalid_text", DocID: input.DocID, Detail: "missing text or order"}
		}
	}
	return input, nil
}

// PublishedQuery returns one JSON object per eligible page. A single SELECT
// provides a consistent MVCC snapshot for metadata and both node lists. $1=0
// selects all eligible pages. No Yjs draft state or historical text is loaded.
const PublishedQuery = `
SELECT jsonb_build_object(
 'pageId',p.id,'spaceId',p.space_id,'createdBy',p.owner_id,
 'docId',d.doc_id,'title',d.title,'createdAt',p.date_created,'updatedAt',d.version,
 'content',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'contentId',c.id,'parentId',COALESCE(c.parent_id,'00000000-0000-0000-0000-000000000000'::uuid),
   'docId',c.doc_id,'orderId',c."order",'type',c.type,'attrs',c.attrs))
   FROM core.content c WHERE c.doc_id=d.doc_id),'[]'::jsonb),
 'text',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'parentId',t.parent_id,'docId',t.doc_id,'orderId',t."order",'text',t.text))
   FROM core.text_node t WHERE t.doc_id=d.doc_id),'[]'::jsonb)
)
FROM core.page p JOIN core.space s ON s.id=p.space_id
JOIN LATERAL (
 SELECT doc_id,title,version FROM core.page_doc_map
 WHERE page_id=p.id AND draft=0 ORDER BY version DESC,doc_id DESC LIMIT 1
) d ON true
WHERE p.type='document' AND s.deleted_at IS NULL AND s.archived_at IS NULL
 AND ($1::bigint=0 OR p.id=$1)
ORDER BY p.id`

type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// ReadPublished issues SELECT only. The caller can additionally use a read-only
// transaction or database role. The visitor must not query on the busy connection.
func ReadPublished(ctx context.Context, db Queryer, pageID int64, visit func(PublishedNodes) error) error {
	if pageID < 0 {
		return fmt.Errorf("pageId must be nonnegative")
	}
	rows, err := db.Query(ctx, PublishedQuery, pageID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			return err
		}
		input, err := DecodePublished(data)
		if err != nil {
			return err
		}
		if err := visit(input); err != nil {
			return err
		}
	}
	return rows.Err()
}
